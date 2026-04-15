import path from "node:path";
import { randomInt } from "node:crypto";
import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { DEFAULT_NOTIFICATION_COOLDOWN_HOURS, XHS_RENT_WATCH_QUERIES } from "../housing/constants.js";
import { sendDiscordDirectMessage } from "../housing/discord.js";
import { evaluateHousingRules } from "../housing/filter.js";
import {
  ADJUDICATION_PROMPT_VERSION,
  VISION_PROMPT_VERSION,
  adjudicateHousingCandidates,
  maybeExtractVisionSignals
} from "../housing/llm.js";
import { estimateLlmUsageCostUsd, inferLlmProvider, resolveLlmTaskTier } from "../llm/runTelemetry.js";
import type {
  HousingAdjudicationResult,
  HousingCandidateForAdjudication,
  HousingCandidateRecord,
  HousingDecision,
  HousingRuleEvaluation,
  HousingVisionSignals,
  XiaohongshuSearchResult
} from "../housing/types.js";
import {
  loadXiaohongshuNote,
  openXiaohongshuLoginSession,
  searchXiaohongshuNotes,
  withPersistentXiaohongshuContext
} from "../housing/xiaohongshu.js";
import { sha256Hex } from "../util/canonicalize.js";
import { truncate, uniqueStrings } from "../util/text.js";

interface RunOptions {
  nowIso?: string;
  dbPathOverride?: string;
}

interface ResolvedEvaluation {
  decision: HousingDecision;
  decisionReasons: string[];
  uncertaintyNotes: string[];
  confidence: number | null;
  city?: string | null;
  neighborhood?: string | null;
  locationSummary?: string | null;
  availabilitySummary?: string | null;
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
  unitType: string;
  wholeUnit: boolean | null;
  femaleOnly: boolean | null;
  sharedSpace: boolean | null;
  roommateOnly: boolean | null;
  commuteFriendly: boolean | null;
}

const QUERY_DELAY_MIN_MS = 5_000;
const QUERY_DELAY_MAX_MS = 12_000;
const NOTE_DELAY_MIN_MS = 5_000;
const NOTE_DELAY_MAX_MS = 10_000;

export async function runXiaohongshuRentWatch(options: RunOptions): Promise<string> {
  const config = loadConfig(process.cwd());
  const dbPath = options.dbPathOverride ? path.resolve(process.cwd(), options.dbPathOverride) : config.dbPath;
  const db = new NewsDatabase(dbPath);
  const now = options.nowIso
    ? DateTime.fromISO(options.nowIso, { zone: config.timezone }).setZone(config.timezone)
    : DateTime.now().setZone(config.timezone);
  const startedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const queries = [...XHS_RENT_WATCH_QUERIES];
  const runId = db.startHousingWatchRun({ startedAt, queries });
  const discordBotToken = config.discordBotToken;
  const discordOwnerUserId = config.discordOwnerUserId;

  if (!discordBotToken || !discordOwnerUserId) {
    db.finishHousingWatchRun({
      runId,
      status: "error",
      completedAt: startedAt,
      harvestedCount: 0,
      candidateCount: 0,
      notifiedCount: 0,
      errorText: "DISCORD_BOT_TOKEN and DISCORD_OWNER_USER_ID are required for xhs-rent-watch",
      stats: {}
    });
    db.close();
    throw new Error("DISCORD_BOT_TOKEN and DISCORD_OWNER_USER_ID are required for xhs-rent-watch");
  }

  let harvestedCount = 0;
  let candidateCount = 0;
  let notifiedCount = 0;
  const queryErrors: string[] = [];
  const noteErrors: string[] = [];
  const llmErrors: string[] = [];
  const notificationErrors: string[] = [];

  try {
    await withPersistentXiaohongshuContext(config, async (context) => {
      const mergedSearchResults = new Map<
        string,
        {
          searchResult: XiaohongshuSearchResult;
          queries: Set<string>;
        }
      >();

      for (const [queryIndex, query] of queries.entries()) {
        try {
          if (queryIndex > 0) {
            await waitWithRandomDelay(`before query ${query}`, QUERY_DELAY_MIN_MS, QUERY_DELAY_MAX_MS);
          }
          console.error(`[xhs-rent-watch] search start: ${query}`);
          const results = await searchXiaohongshuNotes(context, query, config.housingWatcher.maxResultsPerQuery);
          console.error(`[xhs-rent-watch] search done: ${query} -> ${results.length} results`);
          harvestedCount += results.length;
          for (const result of results) {
            const existing = mergedSearchResults.get(result.noteId);
            if (!existing) {
              mergedSearchResults.set(result.noteId, {
                searchResult: result,
                queries: new Set([query])
              });
              continue;
            }

            existing.queries.add(query);
            existing.searchResult = {
              ...existing.searchResult,
              title: existing.searchResult.title.length >= result.title.length ? existing.searchResult.title : result.title,
              authorName: existing.searchResult.authorName ?? result.authorName,
              coverImageUrl: existing.searchResult.coverImageUrl ?? result.coverImageUrl,
              rawPayload: {
                ...existing.searchResult.rawPayload,
                ...result.rawPayload
              }
            };
          }
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          console.error(`[xhs-rent-watch] search error: ${query} | ${messageText}`);
          queryErrors.push(`${query}: ${messageText}`);
        }
      }

      if (mergedSearchResults.size === 0 && queryErrors.length > 0) {
        console.error(`[xhs-rent-watch] no readable search results harvested; queryErrors=${queryErrors.length}`);
        await maybeSendMaintenanceNotification({
          db,
          config,
          now,
          messageText: summarizeErrors(queryErrors)
        });
      }

      const candidates: Array<
        HousingCandidateForAdjudication & {
          rawPayload: Record<string, unknown>;
          llmInputHash: string;
        }
      > = [];
      const adjudicationInputs = new Map<string, string>();
      const visionUsageByNote = new Map<string, Record<string, unknown> | null>();
      const llmModelName = config.llm.summaryModel;
      const llmProvider = inferLlmProvider(llmModelName);

      for (const [candidateIndex, { searchResult, queries: querySet }] of [...mergedSearchResults.values()].entries()) {
        try {
          if (candidateIndex > 0) {
            await waitWithRandomDelay(`before note ${searchResult.noteId}`, NOTE_DELAY_MIN_MS, NOTE_DELAY_MAX_MS);
          }
          console.error(`[xhs-rent-watch] note load: ${searchResult.noteId}`);
          const note = await loadXiaohongshuNote(context, searchResult);
          let ruleEvaluation = evaluateHousingRules({
            title: note.title,
            bodyText: note.bodyText,
            pageText: note.pageText,
            locationText: note.locationText,
            ocrText: null
          });

          let visionSignals: HousingVisionSignals | null = null;
          if (config.llm.enabled && config.openAiApiKey && config.housingWatcher.visionEnabled && ruleEvaluation.decision !== "reject") {
            let visionRunId: number | null = null;
            const visionStartedMillis = Date.now();
            try {
              const visionInputHash = buildCandidateInputHash({
                ...note,
                searchQueries: [...querySet],
                ruleEvaluation,
                visionSignals: null
              });
              const visionTaskKey = "housing_vision.extract";
              const visionStartedAt = DateTime.now().toUTC().toISO() ?? new Date().toISOString();
              visionRunId = db.startLlmRun({
                profileKey: "tech",
                runType: "housing_vision",
                taskKey: visionTaskKey,
                taskTier: resolveLlmTaskTier("housing_vision", visionTaskKey),
                provider: llmProvider,
                modelName: llmModelName,
                promptVersion: VISION_PROMPT_VERSION,
                inputHash: visionInputHash,
                startedAt: visionStartedAt
              });
              const vision = await maybeExtractVisionSignals({
                apiKey: config.openAiApiKey,
                config,
                candidate: {
                  ...note,
                  searchQueries: [...querySet],
                  ruleEvaluation
                }
              });
              if (vision) {
                visionSignals = vision.data;
                visionUsageByNote.set(note.noteId, vision.usage ?? null);
                db.finishLlmRun({
                  runId: visionRunId,
                  status: "ok",
                  completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
                  latencyMs: Date.now() - visionStartedMillis,
                  tokenUsage: vision.usage ?? null,
                  estimatedCostUsd: estimateLlmUsageCostUsd({
                    provider: llmProvider,
                    modelName: llmModelName,
                    usage: vision.usage ?? null
                  })
                });
                ruleEvaluation = evaluateHousingRules({
                  title: note.title,
                  bodyText: note.bodyText,
                  pageText: note.pageText,
                  locationText: note.locationText,
                  ocrText: vision.data.ocrText
                });
              } else {
                db.finishLlmRun({
                  runId: visionRunId,
                  status: "partial",
                  completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
                  latencyMs: Date.now() - visionStartedMillis,
                  errorText: "Vision extraction returned no result"
                });
              }
            } catch (error) {
              if (visionRunId != null) {
                db.finishLlmRun({
                  runId: visionRunId,
                  status: "error",
                  completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
                  latencyMs: Date.now() - visionStartedMillis,
                  errorText: error instanceof Error ? error.message : String(error)
                });
              }
              llmErrors.push(`vision ${note.noteId}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          const candidate: HousingCandidateForAdjudication & {
            rawPayload: Record<string, unknown>;
            llmInputHash: string;
          } = {
            ...note,
            searchQueries: [...querySet],
            ruleEvaluation,
            visionSignals,
            rawPayload: {
              ...note.rawPayload,
              searchQueries: [...querySet]
            },
            llmInputHash: buildCandidateInputHash({
              ...note,
              searchQueries: [...querySet],
              ruleEvaluation,
              visionSignals
            })
          };

          adjudicationInputs.set(candidate.noteId, candidate.llmInputHash);
          candidates.push(candidate);
          console.error(`[xhs-rent-watch] note ready: ${candidate.noteId} rule=${candidate.ruleEvaluation.decision}`);
        } catch (error) {
          noteErrors.push(`${searchResult.noteId}: ${error instanceof Error ? error.message : String(error)}`);
          console.error(`[xhs-rent-watch] note error: ${searchResult.noteId}`);
        }
      }

      const adjudications = new Map<string, HousingAdjudicationResult>();
      if (config.llm.enabled && config.openAiApiKey) {
        const eligible = candidates.filter((candidate) => candidate.ruleEvaluation.decision !== "reject");
        for (const batch of chunk(eligible, 5)) {
          let adjudicationRunId: number | null = null;
          const adjudicationStartedMillis = Date.now();
          try {
            console.error(`[xhs-rent-watch] adjudication batch: ${batch.length}`);
            const adjudicationTaskKey = "housing_adjudication.batch";
            adjudicationRunId = db.startLlmRun({
              profileKey: "tech",
              runType: "housing_adjudication",
              taskKey: adjudicationTaskKey,
              taskTier: resolveLlmTaskTier("housing_adjudication", adjudicationTaskKey),
              provider: llmProvider,
              modelName: llmModelName,
              promptVersion: ADJUDICATION_PROMPT_VERSION,
              inputHash: sha256Hex(JSON.stringify(batch.map((candidate) => candidate.llmInputHash))),
              startedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString()
            });
            const response = await adjudicateHousingCandidates({
              apiKey: config.openAiApiKey,
              config,
              candidates: batch
            });

            db.finishLlmRun({
              runId: adjudicationRunId,
              status: response.results.length === batch.length ? "ok" : "partial",
              completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
              latencyMs: Date.now() - adjudicationStartedMillis,
              tokenUsage: response.usage ?? null,
              estimatedCostUsd: estimateLlmUsageCostUsd({
                provider: llmProvider,
                modelName: llmModelName,
                usage: response.usage ?? null
              }),
              errorText:
                response.results.length === batch.length
                  ? null
                  : `Only adjudicated ${response.results.length}/${batch.length} candidates`
            });

            for (const result of response.results) {
              adjudications.set(result.noteId, result);
            }
          } catch (error) {
            if (adjudicationRunId != null) {
              db.finishLlmRun({
                runId: adjudicationRunId,
                status: "error",
                completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
                latencyMs: Date.now() - adjudicationStartedMillis,
                errorText: error instanceof Error ? error.message : String(error)
              });
            }
            llmErrors.push(`adjudication: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      for (const candidate of candidates) {
        const adjudication = adjudications.get(candidate.noteId) ?? null;
        const resolved = resolveEvaluation(candidate.ruleEvaluation, adjudication);
        const saved = db.upsertHousingWatchCandidate({
          noteId: candidate.noteId,
          noteUrl: candidate.noteUrl,
          title: candidate.title,
          authorName: candidate.authorName ?? null,
          city: resolved.city ?? candidate.ruleEvaluation.city ?? null,
          neighborhood: resolved.neighborhood ?? candidate.ruleEvaluation.neighborhood ?? null,
          locationSummary: resolved.locationSummary ?? candidate.ruleEvaluation.locationSummary ?? candidate.locationText ?? null,
          locationText: candidate.locationText ?? null,
          postedAt: candidate.postedAt ?? null,
          seenAt: startedAt,
          lastEvaluatedAt: startedAt,
          searchQueries: candidate.searchQueries,
          bodyText: candidate.bodyText,
          pageText: candidate.pageText,
          ocrText: candidate.visionSignals?.ocrText ?? null,
          imageUrls: candidate.imageUrls,
          screenshotCaptured: Boolean(candidate.screenshotDataUrl),
          hardFilterDecision: candidate.ruleEvaluation.decision,
          hardFilterReasons: candidate.ruleEvaluation.decisionReasons,
          llmPromptVersion: adjudication ? ADJUDICATION_PROMPT_VERSION : null,
          llmModelName: adjudication ? config.llm.summaryModel : null,
          llmInputHash: adjudication ? adjudicationInputs.get(candidate.noteId) ?? candidate.llmInputHash : null,
          llmOutput: adjudication
            ? {
                adjudicationPromptVersion: ADJUDICATION_PROMPT_VERSION,
                adjudicationResult: adjudication,
                visionPromptVersion: candidate.visionSignals ? VISION_PROMPT_VERSION : null,
                visionSignals: candidate.visionSignals ?? null,
                visionUsage: visionUsageByNote.get(candidate.noteId) ?? null
              }
            : candidate.visionSignals
              ? {
                  visionPromptVersion: VISION_PROMPT_VERSION,
                  visionSignals: candidate.visionSignals,
                  visionUsage: visionUsageByNote.get(candidate.noteId) ?? null
                }
              : null,
          decision: resolved.decision,
          decisionReasons: resolved.decisionReasons,
          confidence: resolved.confidence,
          unitType: resolved.unitType,
          wholeUnit: resolved.wholeUnit,
          femaleOnly: resolved.femaleOnly,
          sharedSpace: resolved.sharedSpace,
          roommateOnly: resolved.roommateOnly,
          availabilitySummary: resolved.availabilitySummary,
          availabilityStart: resolved.availabilityStart,
          availabilityEnd: resolved.availabilityEnd,
          commuteFriendly: resolved.commuteFriendly,
          rawPayload: candidate.rawPayload
        });
        candidateCount += 1;

        if (saved.decision === "reject") {
          continue;
        }

        const deliveryKey = `candidate:${saved.noteId}:${saved.decision}`;
        if (db.getHousingNotificationByDeliveryKey(deliveryKey)) {
          console.error(`[xhs-rent-watch] skip duplicate notify: ${deliveryKey}`);
          continue;
        }

        const message = renderCandidateNotification(saved, resolved);
        const notification = db.createHousingNotification({
          candidateId: saved.id,
          notificationType: "candidate",
          deliveryKey,
          destinationUserId: discordOwnerUserId,
          status: "pending",
          messageText: message,
          createdAt: startedAt
        });

        try {
          console.error(`[xhs-rent-watch] notify: ${saved.noteId} ${saved.decision}`);
          await sendDiscordDirectMessage({
            token: discordBotToken,
            userId: discordOwnerUserId,
            content: message
          });
          db.updateHousingNotification({
            id: notification.id,
            status: "sent",
            sentAt: startedAt
          });
          notifiedCount += 1;
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          notificationErrors.push(`${saved.noteId}: ${messageText}`);
          db.updateHousingNotification({
            id: notification.id,
            status: "error",
            errorText: messageText
          });
        }
      }
    });

    const status: "ok" | "partial" =
      queryErrors.length > 0 || noteErrors.length > 0 || llmErrors.length > 0 || notificationErrors.length > 0 ? "partial" : "ok";

    db.finishHousingWatchRun({
      runId,
      status,
      completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
      harvestedCount,
      candidateCount,
      notifiedCount,
      errorText: status === "partial" ? summarizeErrors(queryErrors, noteErrors, llmErrors, notificationErrors) : null,
      stats: {
        queryErrors,
        noteErrors,
        llmErrors,
        notificationErrors
      }
    });

    return `XHS rent watch complete. harvested=${harvestedCount} candidates=${candidateCount} notified=${notifiedCount}`;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await maybeSendMaintenanceNotification({
      db,
      config,
      now,
      messageText
    });

    db.finishHousingWatchRun({
      runId,
      status: "error",
      completedAt: DateTime.now().toUTC().toISO() ?? new Date().toISOString(),
      harvestedCount,
      candidateCount,
      notifiedCount,
      errorText: messageText,
      stats: {
        queryErrors,
        noteErrors,
        llmErrors,
        notificationErrors
      }
    });

    throw error;
  } finally {
    db.close();
  }
}

export async function runXiaohongshuLogin(): Promise<void> {
  const config = loadConfig(process.cwd());
  await openXiaohongshuLoginSession(config);
}

export function resolveEvaluation(
  rule: HousingRuleEvaluation,
  adjudication: HousingAdjudicationResult | null
): ResolvedEvaluation {
  if (!adjudication) {
    return {
      decision: rule.decision,
      decisionReasons: rule.decisionReasons,
      uncertaintyNotes: rule.decision === "maybe" ? rule.decisionReasons : [],
      confidence: rule.decision === "match" ? 0.72 : rule.decision === "maybe" ? 0.45 : 0.95,
      city: rule.city,
      neighborhood: rule.neighborhood,
      locationSummary: rule.locationSummary,
      availabilitySummary: rule.availabilitySummary,
      availabilityStart: rule.availabilityStart,
      availabilityEnd: rule.availabilityEnd,
      unitType: rule.unitType,
      wholeUnit: rule.wholeUnit,
      femaleOnly: rule.femaleOnly,
      sharedSpace: rule.sharedSpace,
      roommateOnly: rule.roommateOnly,
      commuteFriendly: rule.commuteFriendly
    };
  }

  const merged: ResolvedEvaluation = {
    decision: adjudication.decision,
    decisionReasons: adjudication.decisionReasons,
    uncertaintyNotes: adjudication.uncertaintyNotes,
    confidence: adjudication.confidence,
    city: adjudication.city ?? rule.city,
    neighborhood: adjudication.neighborhood ?? rule.neighborhood,
    locationSummary: adjudication.locationSummary ?? rule.locationSummary,
    availabilitySummary: adjudication.availabilitySummary ?? rule.availabilitySummary,
    availabilityStart: adjudication.availabilityStart ?? rule.availabilityStart,
    availabilityEnd: adjudication.availabilityEnd ?? rule.availabilityEnd,
    unitType: adjudication.unitType === "unknown" ? rule.unitType : adjudication.unitType,
    wholeUnit: adjudication.wholeUnit ?? rule.wholeUnit,
    femaleOnly: adjudication.femaleOnly ?? rule.femaleOnly,
    sharedSpace: adjudication.sharedSpace ?? rule.sharedSpace,
    roommateOnly: adjudication.roommateOnly ?? rule.roommateOnly,
    commuteFriendly: adjudication.commuteFriendly ?? rule.commuteFriendly
  };

  if (rule.decision === "reject" || merged.femaleOnly || merged.sharedSpace || merged.roommateOnly || merged.unitType === "other") {
    return {
      ...merged,
      decision: "reject",
      decisionReasons: uniqueStrings([...rule.decisionReasons, ...merged.decisionReasons]),
      uncertaintyNotes: []
    };
  }

  if (merged.decision === "match" && !canPromoteToMatch(merged)) {
    return {
      ...merged,
      decision: "maybe",
      decisionReasons: uniqueStrings([...merged.decisionReasons, "핵심 조건 중 일부가 본문/이미지 기준으로 여전히 불명확합니다."])
    };
  }

  if (rule.decision === "maybe" && merged.decision === "match" && !canPromoteToMatch(merged)) {
    return {
      ...merged,
      decision: "maybe",
      decisionReasons: uniqueStrings([...rule.decisionReasons, ...merged.decisionReasons])
    };
  }

  if (rule.decision === "match" && merged.decision === "maybe") {
    return {
      ...merged,
      decisionReasons: uniqueStrings([...rule.decisionReasons, ...merged.decisionReasons])
    };
  }

  return merged;
}

function canPromoteToMatch(evaluation: ResolvedEvaluation): boolean {
  return Boolean(
    (evaluation.unitType === "studio" || evaluation.unitType === "1b1b") &&
      evaluation.wholeUnit === true &&
      evaluation.femaleOnly !== true &&
      evaluation.sharedSpace !== true &&
      evaluation.roommateOnly !== true &&
      evaluation.commuteFriendly !== false &&
      evaluation.availabilitySummary
  );
}

function renderCandidateNotification(candidate: HousingCandidateRecord, evaluation: ResolvedEvaluation): string {
  const checks = [
    evaluation.femaleOnly === true ? "female-only suspected" : "female-only: no",
    evaluation.sharedSpace === true ? "shared space suspected" : "shared kitchen/bath: no",
    evaluation.roommateOnly === true ? "roommate post suspected" : "roommate post: no"
  ];

  const lines = [
    candidate.decision === "match" ? "[Match]" : "[Possible Match]",
    candidate.title,
    "",
    `Location: ${evaluation.locationSummary ?? evaluation.neighborhood ?? evaluation.city ?? "unknown"}`,
    `Dates: ${evaluation.availabilitySummary ?? "unknown"}`,
    `Unit: ${evaluation.unitType}${evaluation.wholeUnit === true ? " whole unit" : evaluation.wholeUnit === false ? " not whole unit" : ""}`,
    `Checks: ${checks.join(" / ")}`,
    `Why: ${evaluation.decisionReasons.join(" / ")}`,
    evaluation.uncertaintyNotes.length > 0 ? `Uncertainty: ${evaluation.uncertaintyNotes.join(" / ")}` : null,
    `Link: ${candidate.noteUrl}`
  ].filter((value): value is string => Boolean(value));

  return truncate(lines.join("\n"), 1800);
}

async function maybeSendMaintenanceNotification(input: {
  db: NewsDatabase;
  config: AppConfig;
  now: DateTime;
  messageText: string;
}): Promise<void> {
  if (!input.config.discordBotToken || !input.config.discordOwnerUserId) {
    return;
  }

  const deliveryKey = "maintenance:xhs-rent-watch";
  const sinceIso = input.now.minus({ hours: DEFAULT_NOTIFICATION_COOLDOWN_HOURS }).toUTC().toISO() ?? new Date().toISOString();
  if (
    input.db.findRecentHousingNotification({
      notificationType: "maintenance",
      deliveryKey,
      sinceIso
    })
  ) {
    return;
  }

  const createdAt = input.now.toUTC().toISO() ?? new Date().toISOString();
  const message = truncate(
    [
      "[Maintenance] Xiaohongshu rent watch needs attention",
      "",
      input.messageText
    ].join("\n"),
    1200
  );

  const notification = input.db.createHousingNotification({
    notificationType: "maintenance",
    deliveryKey,
    destinationUserId: input.config.discordOwnerUserId,
    status: "pending",
    messageText: message,
    createdAt
  });

  try {
    await sendDiscordDirectMessage({
      token: input.config.discordBotToken,
      userId: input.config.discordOwnerUserId,
      content: message
    });
    input.db.updateHousingNotification({
      id: notification.id,
      status: "sent",
      sentAt: createdAt
    });
  } catch (error) {
    input.db.updateHousingNotification({
      id: notification.id,
      status: "error",
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildCandidateInputHash(candidate: HousingCandidateForAdjudication): string {
  return sha256Hex(
    JSON.stringify({
      noteId: candidate.noteId,
      title: candidate.title,
      bodyText: candidate.bodyText,
      pageText: candidate.pageText,
      locationText: candidate.locationText ?? null,
      searchQueries: candidate.searchQueries,
      ruleEvaluation: candidate.ruleEvaluation,
      visionSignals: candidate.visionSignals ?? null
    })
  );
}

function summarizeErrors(...groups: string[][]): string {
  return groups
    .flat()
    .slice(0, 6)
    .join(" | ");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function waitWithRandomDelay(label: string, minMs: number, maxMs: number): Promise<number> {
  const delayMs = randomInt(minMs, maxMs + 1);
  console.error(`[xhs-rent-watch] wait: ${label} | ${delayMs}ms`);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return delayMs;
}
