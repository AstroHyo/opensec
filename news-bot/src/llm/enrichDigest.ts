import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import {
  applyThemeSections,
  assignNumbers,
  buildTechSectionsFromEntries,
  buildThemes
} from "../digest/buildDigest.js";
import type { NewsDatabase } from "../db.js";
import { embedArticleContexts, ensureArticleContexts } from "../evidence/articleContext.js";
import type { ArticleContextRecord, DigestBuildResult, DigestEntry, ItemEnrichmentRecord } from "../types.js";
import { sha256Hex } from "../util/canonicalize.js";
import { collapseWhitespace, truncate } from "../util/text.js";
import { renderTelegramDigest } from "../digest/renderTelegram.js";
import { generateStructuredJson } from "./openaiClient.js";
import { buildRepoUseCaseFallback, preferKoreanNarrative, preferOptionalKoreanNarrative, sanitizeNarrativeList, sanitizeThemeBullets } from "./koreanOutput.js";
import { buildItemEnrichmentPrompts, buildThemeSynthesisPrompts } from "./promptTemplates.js";
import { estimateLlmCostUsd, routeLlmTask } from "./taskRouter.js";
import {
  digestThemeJsonSchema,
  digestThemeSchema,
  itemEnrichmentBatchSchema,
  itemEnrichmentJsonSchema,
  ITEM_ENRICHMENT_PROMPT_VERSION,
  THEME_SYNTHESIS_PROMPT_VERSION
} from "./schemas.js";

export async function maybeEnrichDigest(input: {
  db: NewsDatabase;
  config: AppConfig;
  digest: DigestBuildResult;
  now: DateTime;
}): Promise<void> {
  if (!input.config.llm.enabled) {
    return;
  }

  const maxItems = input.digest.mode === "am" ? input.config.llm.maxItemsAm : input.config.llm.maxItemsPm;
  const targetItems =
    input.digest.profileKey === "tech"
      ? (input.digest.candidateEntries ?? input.digest.items).slice(0, maxItems)
      : input.digest.items.slice(0, maxItems);

  if (targetItems.length > 0) {
    await enrichItems(input.db, input.config, targetItems, input.digest.mode, input.now);
  }

  if (input.digest.profileKey === "tech" && targetItems.length > 0) {
    rebuildTechDigest(input.digest, targetItems);
  }

  if (input.config.llm.themesEnabled && input.digest.items.length > 0) {
    await enrichThemes(input.db, input.config, input.digest, input.now);
  }

  input.digest.bodyText = renderTelegramDigest(input.digest);
}

async function enrichItems(
  db: NewsDatabase,
  config: AppConfig,
  items: DigestEntry[],
  mode: DigestBuildResult["mode"],
  now: DateTime
): Promise<void> {
  const route = routeLlmTask({
    config,
    taskKey: "item_enrichment",
    spentTodayUsd: db.getDailyLlmSpendUsd(items[0]?.profileKey ?? "tech", now.startOf("day").toUTC().toISO() ?? startedIso(now))
  });
  if (!route.enabled || !route.apiKey) {
    return;
  }

  const contexts = await ensureArticleContexts({
    db,
    config,
    items,
    fetchedAt: now.toUTC().toISO() ?? new Date().toISOString()
  });
  embedArticleContexts(items, contexts);
  const missing: DigestEntry[] = [];

  for (const item of items) {
    const articleContext = contexts.get(item.itemId) ?? null;
    const sourceHash = buildItemSourceHash(item, articleContext);
    const record = db.getItemEnrichment(item.profileKey, item.itemId, ITEM_ENRICHMENT_PROMPT_VERSION, sourceHash);
    if (record) {
      applyItemEnrichment(item, record);
    } else {
      missing.push(item);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const inputHash = sha256Hex(
    JSON.stringify(
      missing.map((item) => ({
        itemId: item.itemId,
        sourceHash: buildItemSourceHash(item, contexts.get(item.itemId) ?? null)
      }))
    )
  );
  const startedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const startedMillis = Date.now();
  const runId = db.startLlmRun({
    profileKey: items[0]?.profileKey ?? "tech",
    runType: route.runType,
    taskKey: route.taskKey,
    taskTier: route.tier,
    provider: route.provider,
    modelName: route.model,
    promptVersion: ITEM_ENRICHMENT_PROMPT_VERSION,
    inputHash,
    startedAt
  });

  try {
    const prompts = buildItemEnrichmentPrompts({ mode, items: missing });
    const response = await generateStructuredJson({
      apiKey: route.apiKey,
      provider: route.provider,
      model: route.model,
      schemaName: "item_enrichment_batch",
      schema: itemEnrichmentJsonSchema,
      validator: itemEnrichmentBatchSchema,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      timeoutMs: route.timeoutMs
    });

    const byId = new Map(response.data.items.map((item) => [item.item_id, item] as const));
    let savedCount = 0;

    for (const item of missing) {
      const enrichment = byId.get(item.itemId);
      if (!enrichment) {
        continue;
      }

      const fallbackWhatChanged = item.whatChanged ?? item.summary;
      const fallbackEngineerRelevance = item.engineerRelevance ?? item.whyImportant;
      const fallbackAiEcosystem = item.aiEcosystem ?? item.whyImportant;
      const fallbackTrendSignal = item.trendSignal ?? item.causeEffect ?? item.whyImportant;
      const fallbackCauseEffect = item.causeEffect ?? item.trendSignal ?? item.whyImportant;
      const repoUseCase = item.itemKind === "repo"
        ? preferOptionalKoreanNarrative(enrichment.repo_use_case_ko, 240) ?? buildRepoUseCaseFallback(item)
        : null;

      const saved = db.saveItemEnrichment({
        profileKey: item.profileKey,
        itemId: item.itemId,
        llmRunId: runId,
        promptVersion: ITEM_ENRICHMENT_PROMPT_VERSION,
        sourceHash: buildItemSourceHash(item, contexts.get(item.itemId) ?? null),
        summaryKo: preferKoreanNarrative(enrichment.what_changed_ko, fallbackWhatChanged, 220),
        whyImportantKo: preferKoreanNarrative(
          [enrichment.engineer_relevance_ko, enrichment.ai_ecosystem_ko].map((value) => collapseWhitespace(value)).join(" "),
          `${fallbackEngineerRelevance} ${fallbackAiEcosystem}`,
          220
        ),
        whatChangedKo: preferKoreanNarrative(enrichment.what_changed_ko, fallbackWhatChanged, 420),
        engineerRelevanceKo: preferKoreanNarrative(enrichment.engineer_relevance_ko, fallbackEngineerRelevance, 240),
        aiEcosystemKo: preferKoreanNarrative(enrichment.ai_ecosystem_ko, fallbackAiEcosystem, 220),
        openAiAngleKo: preferOptionalKoreanNarrative(enrichment.openai_angle_ko, 180),
        repoUseCaseKo: repoUseCase,
        trendSignalKo: preferKoreanNarrative(enrichment.trend_signal_ko, fallbackTrendSignal, 180),
        causeEffectKo: preferKoreanNarrative(enrichment.cause_effect_ko, fallbackCauseEffect, 180),
        watchpoints: sanitizeNarrativeList(enrichment.watchpoints_ko, 3, 120),
        evidenceSpans: sanitizeNarrativeList(enrichment.evidence_spans, 4, 180),
        noveltyScore: enrichment.novelty_score,
        insightScore: enrichment.insight_score,
        confidence: enrichment.confidence,
        uncertaintyNotes: sanitizeNarrativeList(enrichment.uncertainty_notes, 3, 110),
        themeTags: enrichment.theme_tags.map((value) => truncate(collapseWhitespace(value), 32)),
        officialnessNote: enrichment.officialness_note,
        createdAt: now.toUTC().toISO() ?? new Date().toISOString()
      });
      applyItemEnrichment(item, saved);
      savedCount += 1;
    }

    db.finishLlmRun({
      runId,
      status: savedCount === missing.length ? "ok" : "partial",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      tokenUsage: response.usage ?? null,
      estimatedCostUsd: estimateLlmCostUsd({
        provider: route.provider,
        model: route.model,
        usage: response.usage ?? null
      }),
      errorText: savedCount === missing.length ? null : `Only enriched ${savedCount}/${missing.length} items`
    });
  } catch (error) {
    db.finishLlmRun({
      runId,
      status: "error",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

async function enrichThemes(
  db: NewsDatabase,
  config: AppConfig,
  digest: DigestBuildResult,
  now: DateTime
): Promise<void> {
  const digestCacheKey = buildDigestThemeCacheKey(digest);
  const cached = db.getDigestThemeEnrichment(digest.profileKey, digestCacheKey, THEME_SYNTHESIS_PROMPT_VERSION);
  if (cached) {
    digest.themes = cached.themes;
    applyThemeBullets(digest);
    return;
  }

  const startedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const startedMillis = Date.now();
  const route = routeLlmTask({
    config,
    taskKey: digest.mode === "pm" ? "theme_synthesis_pm" : "theme_synthesis_am",
    spentTodayUsd: db.getDailyLlmSpendUsd(digest.profileKey, now.startOf("day").toUTC().toISO() ?? startedAt)
  });
  if (!route.enabled || !route.apiKey) {
    return;
  }
  const runId = db.startLlmRun({
    profileKey: digest.profileKey,
    runType: route.runType,
    taskKey: route.taskKey,
    taskTier: route.tier,
    provider: route.provider,
    modelName: route.model,
    promptVersion: THEME_SYNTHESIS_PROMPT_VERSION,
    inputHash: digestCacheKey,
    startedAt
  });

  try {
    const prompts = buildThemeSynthesisPrompts({ mode: digest.mode, items: digest.items });
    const response = await generateStructuredJson({
      apiKey: route.apiKey,
      provider: route.provider,
      model: route.model,
      schemaName: "digest_theme_synthesis",
      schema: digestThemeJsonSchema,
      validator: digestThemeSchema,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      timeoutMs: route.timeoutMs
    });

    const themes = sanitizeThemeBullets(
      response.data.themes_ko,
      digest.themes,
      digest.mode === "am" ? 2 : 4,
      160
    );

    if (themes.length > 0) {
      db.saveDigestThemeEnrichment({
        profileKey: digest.profileKey,
        digestCacheKey,
        digestMode: digest.mode,
        llmRunId: runId,
        promptVersion: THEME_SYNTHESIS_PROMPT_VERSION,
        themes,
        createdAt: now.toUTC().toISO() ?? new Date().toISOString()
      });
      digest.themes = themes;
      applyThemeBullets(digest);
    }

    db.finishLlmRun({
      runId,
      status: themes.length > 0 ? "ok" : "partial",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      tokenUsage: response.usage ?? null,
      estimatedCostUsd: estimateLlmCostUsd({
        provider: route.provider,
        model: route.model,
        usage: response.usage ?? null
      }),
      errorText: themes.length > 0 ? null : "Model returned no usable theme bullets"
    });
  } catch (error) {
    db.finishLlmRun({
      runId,
      status: "error",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

function startedIso(now: DateTime): string {
  return now.toUTC().toISO() ?? new Date().toISOString();
}

export function buildItemSourceHash(item: DigestEntry, articleContext?: ArticleContextRecord | null): string {
  return sha256Hex(
    JSON.stringify({
      itemId: item.itemId,
      profileKey: item.profileKey,
      title: item.title,
      summary: item.summary,
      whyImportant: item.whyImportant,
      contentSnippet: item.contentSnippet ?? null,
      description: item.description ?? null,
      keywords: item.keywords,
      scoreReasons: item.scoreReasons,
      sourceLinks: item.sourceLinks,
      openaiCategory: item.openaiCategory ?? null,
      repoLanguage: item.repoLanguage ?? null,
      repoStarsToday: item.repoStarsToday ?? null,
      articleContext: articleContext
        ? {
            headline: articleContext.headline,
            dek: articleContext.dek ?? null,
            publisher: articleContext.publisher ?? null,
            fetchStatus: articleContext.fetchStatus,
            cleanText: articleContext.cleanText,
            keySections: articleContext.keySections,
            evidenceSnippets: articleContext.evidenceSnippets
          }
        : null
    })
  );
}

export function buildDigestThemeCacheKey(digest: DigestBuildResult): string {
  return sha256Hex(
    JSON.stringify({
      profileKey: digest.profileKey,
      mode: digest.mode,
      items: digest.items.map((item) => ({
        itemId: item.itemId,
        title: item.title,
        whatChanged: item.whatChanged ?? item.summary,
        engineerRelevance: item.engineerRelevance ?? item.whyImportant,
        aiEcosystem: item.aiEcosystem ?? "",
        trendSignal: item.trendSignal ?? "",
        causeEffect: item.causeEffect ?? "",
        keywords: item.keywords,
        scoreReasons: item.scoreReasons
      }))
    })
  );
}

export function applyItemEnrichment(item: DigestEntry, enrichment: ItemEnrichmentRecord): void {
  const fallbackWhatChanged = item.whatChanged ?? item.summary;
  const fallbackEngineerRelevance = item.engineerRelevance ?? item.whyImportant;
  const fallbackAiEcosystem = item.aiEcosystem ?? item.whyImportant;
  const fallbackTrendSignal = item.trendSignal ?? item.causeEffect ?? item.whyImportant;
  const fallbackCauseEffect = item.causeEffect ?? item.trendSignal ?? item.whyImportant;

  item.summary = preferKoreanNarrative(enrichment.whatChangedKo ?? enrichment.summaryKo, fallbackWhatChanged, 220);
  item.whyImportant = preferKoreanNarrative(
    [enrichment.engineerRelevanceKo, enrichment.aiEcosystemKo].filter(Boolean).join(" ") || enrichment.whyImportantKo,
    `${fallbackEngineerRelevance} ${fallbackAiEcosystem}`,
    220
  );
  item.whatChanged = preferKoreanNarrative(enrichment.whatChangedKo ?? enrichment.summaryKo, fallbackWhatChanged, 420);
  item.engineerRelevance = preferKoreanNarrative(enrichment.engineerRelevanceKo, fallbackEngineerRelevance, 240);
  item.aiEcosystem = preferKoreanNarrative(enrichment.aiEcosystemKo, fallbackAiEcosystem, 220);
  item.openAiAngle = preferOptionalKoreanNarrative(enrichment.openAiAngleKo, 180);
  item.repoUseCase = item.itemKind === "repo"
    ? preferOptionalKoreanNarrative(enrichment.repoUseCaseKo, 240) ?? buildRepoUseCaseFallback(item)
    : null;
  item.trendSignal = preferKoreanNarrative(enrichment.trendSignalKo, fallbackTrendSignal, 180);
  item.causeEffect = preferKoreanNarrative(enrichment.causeEffectKo, fallbackCauseEffect, 180);
  item.watchpoints = enrichment.watchpoints.length > 0 ? sanitizeNarrativeList(enrichment.watchpoints, 3, 120) : item.watchpoints;
  item.evidenceSpans = enrichment.evidenceSpans.length > 0 ? enrichment.evidenceSpans : item.evidenceSpans;
  item.wasLlmEnriched = true;
  item.enrichmentConfidence = enrichment.confidence;
  item.uncertaintyNotes = enrichment.uncertaintyNotes;
  item.themeTags = enrichment.themeTags;
  item.officialnessNote = enrichment.officialnessNote ?? null;
  if (enrichment.noveltyScore != null || enrichment.insightScore != null) {
    const delta = computeRerankDelta(item, enrichment);
    item.rerankDelta = delta;
    item.finalScore = (item.deterministicScore ?? item.score) + delta;
    item.score = Math.round(item.finalScore);
  }
}

function applyThemeBullets(digest: DigestBuildResult): void {
  const targetKey = digest.mode === "pm" ? "what_this_means" : "themes";
  const section = digest.sections.find((candidate) => candidate.key === targetKey);
  if (!section) {
    return;
  }
  section.bullets = digest.themes;
}

function computeRerankDelta(item: DigestEntry, enrichment: ItemEnrichmentRecord): number {
  const novelty = enrichment.noveltyScore ?? 0.5;
  const insight = enrichment.insightScore ?? 0.5;
  const evidenceDepth = Math.min(1, ((item.evidenceSpans?.length ?? 0) * 0.18) + embeddedWordDepth(item));
  const raw = (insight - 0.5) * 8 + (novelty - 0.5) * 5 + (evidenceDepth - 0.4) * 4;
  const bounded = clamp(raw, -4, 8);
  return Math.round(bounded * 10) / 10;
}

function embeddedWordDepth(item: DigestEntry): number {
  const articleContext = getEmbeddedArticleContext(item);
  const words = Number(articleContext?.wordCount ?? 0);
  return clamp(words / 2200, 0, 1);
}

function getEmbeddedArticleContext(item: DigestEntry): {
  wordCount?: number;
} | null {
  const metadata = item.metadata as Record<string, unknown>;
  const articleContext = metadata.articleContext;
  if (!articleContext || typeof articleContext !== "object") {
    return null;
  }
  return articleContext as { wordCount?: number };
}

function rebuildTechDigest(digest: DigestBuildResult, candidatePool: DigestEntry[]): void {
  const sorted = [...candidatePool].sort((left, right) => {
    const rightScore = right.finalScore ?? right.deterministicScore ?? right.score;
    const leftScore = left.finalScore ?? left.deterministicScore ?? left.score;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    if (right.sourceType === "openai_official" && left.sourceType !== "openai_official") {
      return 1;
    }
    if (left.sourceType === "openai_official" && right.sourceType !== "openai_official") {
      return -1;
    }
    return (right.deterministicScore ?? right.score) - (left.deterministicScore ?? left.score);
  });

  digest.candidateEntries = sorted;
  digest.sections = buildTechSectionsFromEntries(sorted, digest.mode);
  assignNumbers(digest.sections);
  digest.items = digest.sections.flatMap((section) => section.items);
  digest.themes = buildThemes(digest.items, digest.mode, digest.profileKey);
  applyThemeSections(digest.sections, digest.themes, digest.mode, digest.profileKey);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
