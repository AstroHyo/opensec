import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { generateStructuredJsonWithWebSearch } from "../llm/openaiClient.js";
import { buildResearchAnswerPrompts } from "../llm/promptTemplates.js";
import { estimateLlmUsageCostUsd, inferLlmProvider, resolveLlmTaskTier } from "../llm/runTelemetry.js";
import {
  RESEARCH_FOLLOWUP_PROMPT_VERSION,
  researchFollowupJsonSchema,
  researchFollowupSchema
} from "../llm/schemas.js";
import type { DigestEntry, ProfileKey } from "../types.js";
import { sha256Hex } from "../util/canonicalize.js";
import { collapseWhitespace, truncate, uniqueStrings } from "../util/text.js";
import { answerAskFollowup } from "./followupAnswer.js";
import { selectRelevantItems } from "./followupContext.js";
import type { FollowupSourceFilter } from "./followupIntent.js";

type ResearchSource = {
  title: string;
  url: string;
  publisher: string;
  whyUsed: string;
  sourceType: "official" | "primary" | "reporting" | "community" | "unknown";
};

export async function answerResearchFollowup(input: {
  db: NewsDatabase;
  config: AppConfig;
  profileKey: ProfileKey;
  question: string;
  now: DateTime;
  referencedNumbers: number[];
  sourceFilter?: FollowupSourceFilter;
}): Promise<string> {
  const digest = input.db.getLatestDigest(input.profileKey);
  if (!digest) {
    return "최근 digest가 없습니다. 먼저 `brief now`를 실행하세요.";
  }

  const selectedItems = selectRelevantItems({
    digest,
    question: input.question,
    referencedNumbers: input.referencedNumbers,
    sourceFilter: input.sourceFilter
  });

  if (selectedItems.length === 0) {
    return "질문과 연결할 저장된 digest 항목을 찾지 못했습니다. 항목 번호나 주제를 조금 더 구체적으로 적어주세요.";
  }

  const apiKey = input.config.openAiApiKey;
  if (!input.config.llm.enabled || !apiKey) {
    return renderResearchFallback(
      await answerAskFollowup({
        db: input.db,
        config: input.config,
        profileKey: input.profileKey,
        question: input.question,
        now: input.now,
        referencedNumbers: input.referencedNumbers,
        sourceFilter: input.sourceFilter
      })
    );
  }

  const unmatchedSignals = input.db.listUnmatchedSignalEvents(
    4,
    input.now.toUTC().minus({ hours: input.config.sourcing.signalWindowHours }).toISO() ?? undefined
  );
  const researchQuestion = augmentQuestionWithSignals(input.question, unmatchedSignals);
  const prompts = buildResearchAnswerPrompts({
    question: researchQuestion,
    items: selectedItems,
    themes: digest.themes
  });
  const startedAt = input.now.toUTC().toISO() ?? new Date().toISOString();
  const startedMillis = Date.now();
  const inputHash = sha256Hex(
    JSON.stringify({
      question: input.question,
      itemIds: selectedItems.map((item) => item.itemId),
      titles: selectedItems.map((item) => item.title),
      unmatchedSignals: unmatchedSignals.map((signal) => ({
        actor: signal.actorLabel,
        linkedUrl: signal.linkedUrl,
        title: signal.title
      }))
    })
  );
  const modelName = input.config.llm.researchModel;
  const taskKey = "followup_research.web";
  const provider = inferLlmProvider(modelName);
  const runId = input.db.startLlmRun({
    profileKey: input.profileKey,
    runType: "followup_research",
    taskKey,
    taskTier: resolveLlmTaskTier("followup_research", taskKey),
    provider,
    modelName,
    promptVersion: RESEARCH_FOLLOWUP_PROMPT_VERSION,
    inputHash,
    startedAt
  });

  try {
    const response = await generateStructuredJsonWithWebSearch({
      apiKey,
      model: input.config.llm.researchModel,
      schemaName: "followup_research",
      schema: researchFollowupJsonSchema,
      validator: researchFollowupSchema,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      timeoutMs: input.config.llm.timeoutMs
    });

    input.db.finishLlmRun({
      runId,
      status: "ok",
      completedAt: input.now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      tokenUsage: response.usage ?? null,
      estimatedCostUsd: estimateLlmUsageCostUsd({
        provider,
        modelName,
        usage: response.usage ?? null,
        webSearchCalls: 1
      })
    });

    const allowedNumbers = new Set(selectedItems.map((item) => item.number));
    const usedNumbers = response.data.used_item_numbers.filter((value) => allowedNumbers.has(value));
    const usedItemNumbers = usedNumbers.length > 0 ? usedNumbers : selectedItems.map((item) => item.number);
    const sources = mergeResearchSources(response.data.sources, response.annotations).slice(0, 6);

    return renderResearchAnswer({
      answer: response.data.answer_ko,
      bullets: response.data.bullets_ko,
      implications: response.data.implications_ko,
      uncertaintyNotes: response.data.uncertainty_notes,
      usedItemNumbers,
      selectedItems,
      sources
    });
  } catch (error) {
    input.db.finishLlmRun({
      runId,
      status: "error",
      completedAt: input.now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      errorText: error instanceof Error ? error.message : String(error)
    });

    return renderResearchFallback(
      await answerAskFollowup({
        db: input.db,
        config: input.config,
        profileKey: input.profileKey,
        question: input.question,
        now: input.now,
        referencedNumbers: input.referencedNumbers,
        sourceFilter: input.sourceFilter
      }),
      "live research가 실패해서 저장된 digest 근거로 먼저 답했습니다."
    );
  }
}

function augmentQuestionWithSignals(
  question: string,
  signals: Array<{ actorLabel: string; linkedUrl?: string | null; title?: string | null }>
): string {
  const hints = signals
    .filter((signal) => signal.linkedUrl)
    .map((signal) => `- ${signal.actorLabel}: ${signal.title ?? "untitled"} | ${signal.linkedUrl}`)
    .slice(0, 4);

  if (hints.length === 0) {
    return question;
  }

  return [question, "", "Potential recent Bluesky signals:", ...hints].join("\n");
}

function renderResearchAnswer(input: {
  answer: string;
  bullets: string[];
  implications: string[];
  uncertaintyNotes: string[];
  usedItemNumbers: number[];
  selectedItems: DigestEntry[];
  sources: ResearchSource[];
}): string {
  return [
    "[Research]",
    "",
    truncate(collapseWhitespace(input.answer), 900),
    input.bullets.length > 0 ? "" : null,
    input.bullets.length > 0 ? input.bullets.map((value) => `- ${truncate(collapseWhitespace(value), 180)}`).join("\n") : null,
    input.implications.length > 0 ? "" : null,
    input.implications.length > 0 ? "우리 관점:" : null,
    input.implications.length > 0 ? input.implications.map((value) => `- ${truncate(collapseWhitespace(value), 180)}`).join("\n") : null,
    "",
    `근거 항목: ${input.usedItemNumbers.join(", ")}`,
    `저장된 출처: ${uniqueStrings(input.selectedItems.map((item) => item.sourceLabel)).join(", ")}`,
    input.uncertaintyNotes.length > 0
      ? `불확실성: ${input.uncertaintyNotes.map((value) => truncate(collapseWhitespace(value), 140)).join(" / ")}`
      : null,
    "",
    "추가 조사 링크:",
    input.sources.length > 0
      ? input.sources
          .map((source, index) => `${index + 1}. ${source.publisher} | ${source.title}\n${source.url}`)
          .join("\n\n")
      : "모델이 명시적 링크 목록을 반환하지 않았습니다."
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function renderResearchFallback(answer: string, note = "live research를 바로 수행할 수 없어 저장된 digest 근거로 먼저 답했습니다."): string {
  return [
    "[Research]",
    "",
    note,
    "",
    answer
  ].join("\n");
}

function mergeResearchSources(
  sources: Array<{
    title: string;
    url: string;
    publisher: string;
    why_used: string;
    source_type: "official" | "primary" | "reporting" | "community" | "unknown";
  }>,
  annotations: Array<{ url: string; title?: string }>
): ResearchSource[] {
  const merged = new Map<string, ResearchSource>();

  for (const source of sources) {
    const normalizedUrl = collapseWhitespace(source.url);
    if (!normalizedUrl) {
      continue;
    }

    merged.set(normalizedUrl, {
      title: truncate(collapseWhitespace(source.title), 160),
      url: normalizedUrl,
      publisher: truncate(collapseWhitespace(source.publisher), 80),
      whyUsed: truncate(collapseWhitespace(source.why_used), 120),
      sourceType: source.source_type
    });
  }

  for (const annotation of annotations) {
    const normalizedUrl = collapseWhitespace(annotation.url);
    if (!normalizedUrl || merged.has(normalizedUrl)) {
      continue;
    }

    merged.set(normalizedUrl, {
      title: truncate(collapseWhitespace(annotation.title ?? "Untitled source"), 160),
      url: normalizedUrl,
      publisher: "Web source",
      whyUsed: "검색 과정에서 인용됨",
      sourceType: "unknown"
    });
  }

  return [...merged.values()];
}
