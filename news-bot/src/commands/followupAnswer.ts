import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { generateStructuredJson } from "../llm/openaiClient.js";
import { buildFollowupAnswerPrompts } from "../llm/promptTemplates.js";
import { estimateLlmCostUsd, routeLlmTask } from "../llm/taskRouter.js";
import {
  ASK_FOLLOWUP_PROMPT_VERSION,
  askFollowupJsonSchema,
  askFollowupSchema
} from "../llm/schemas.js";
import type { DigestEntry, ProfileKey, SavedDigestRecord } from "../types.js";
import { sha256Hex } from "../util/canonicalize.js";
import { collapseWhitespace, truncate, uniqueStrings } from "../util/text.js";
import { selectRelevantItems, summarizeSources } from "./followupContext.js";
import type { FollowupSourceFilter } from "./followupIntent.js";

export async function answerAskFollowup(input: {
  db: NewsDatabase;
  config: AppConfig;
  profileKey: ProfileKey;
  question: string;
  now: DateTime;
  referencedNumbers: number[];
  sourceFilter?: FollowupSourceFilter;
  comparisonRequested?: boolean;
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

  const llmAnswer = await maybeAnswerWithLlm({
    question: input.question,
    selectedItems,
    digest,
    db: input.db,
    config: input.config,
    profileKey: input.profileKey,
    now: input.now
  });

  if (llmAnswer) {
    return renderAskAnswer({
      answer: llmAnswer.answer,
      bullets: llmAnswer.bullets,
      selectedItems,
      usedNumbers: llmAnswer.usedNumbers,
      uncertaintyNotes: llmAnswer.uncertaintyNotes
    });
  }

  return renderAskFallback({
    question: input.question,
    selectedItems,
    comparisonRequested: Boolean(input.comparisonRequested)
  });
}

async function maybeAnswerWithLlm(input: {
  question: string;
  selectedItems: DigestEntry[];
  digest: SavedDigestRecord;
  db: NewsDatabase;
  config: AppConfig;
  profileKey: ProfileKey;
  now: DateTime;
}): Promise<{ answer: string; bullets: string[]; usedNumbers: number[]; uncertaintyNotes: string[] } | null> {
  const route = routeLlmTask({
    config: input.config,
    taskKey: "followup_answer",
    spentTodayUsd: input.db.getDailyLlmSpendUsd(
      input.profileKey,
      input.now.startOf("day").toUTC().toISO() ?? startedIso(input.now)
    )
  });
  if (!route.enabled || !route.apiKey) {
    return null;
  }

  const prompts = buildFollowupAnswerPrompts({
    question: input.question,
    items: input.selectedItems,
    themes: input.digest.themes
  });
  const startedAt = input.now.toUTC().toISO() ?? new Date().toISOString();
  const startedMillis = Date.now();
  const inputHash = sha256Hex(
    JSON.stringify({
      question: input.question,
      itemIds: input.selectedItems.map((item) => item.itemId),
      sourceLinks: input.selectedItems.map((item) => item.sourceLinks)
    })
  );
  const runId = input.db.startLlmRun({
    profileKey: input.profileKey,
    runType: route.runType,
    taskKey: route.taskKey,
    taskTier: route.tier,
    provider: route.provider,
    modelName: route.model,
    promptVersion: ASK_FOLLOWUP_PROMPT_VERSION,
    inputHash,
    startedAt
  });

  try {
    const response = await generateStructuredJson({
      apiKey: route.apiKey,
      provider: route.provider,
      model: route.model,
      schemaName: "followup_answer",
      schema: askFollowupJsonSchema,
      validator: askFollowupSchema,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      timeoutMs: route.timeoutMs
    });

    input.db.finishLlmRun({
      runId,
      status: "ok",
      completedAt: input.now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      tokenUsage: response.usage ?? null,
      estimatedCostUsd: estimateLlmCostUsd({
        provider: route.provider,
        model: route.model,
        usage: response.usage ?? null
      })
    });

    const allowedNumbers = new Set(input.selectedItems.map((item) => item.number));
    const usedNumbers = response.data.used_item_numbers.filter((value) => allowedNumbers.has(value));

    return {
      answer: truncate(collapseWhitespace(response.data.answer_ko), 700),
      bullets: response.data.bullets_ko.map((value) => truncate(collapseWhitespace(value), 160)),
      usedNumbers: usedNumbers.length > 0 ? usedNumbers : input.selectedItems.map((item) => item.number),
      uncertaintyNotes: response.data.uncertainty_notes.map((value) => truncate(collapseWhitespace(value), 140))
    };
  } catch (error) {
    input.db.finishLlmRun({
      runId,
      status: "error",
      completedAt: input.now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      errorText: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function startedIso(now: DateTime): string {
  return now.toUTC().toISO() ?? new Date().toISOString();
}

function renderAskAnswer(input: {
  answer: string;
  bullets: string[];
  selectedItems: DigestEntry[];
  usedNumbers: number[];
  uncertaintyNotes: string[];
}): string {
  const sourceSummary = summarizeSources(input.selectedItems, input.usedNumbers);

  return [
    "[Ask]",
    "",
    input.answer,
    input.bullets.length > 0 ? "" : null,
    input.bullets.length > 0 ? input.bullets.map((value) => `- ${value}`).join("\n") : null,
    "",
    `근거 항목: ${input.usedNumbers.join(", ")}`,
    `출처: ${sourceSummary.join(", ")}`,
    input.uncertaintyNotes.length > 0 ? `불확실성: ${input.uncertaintyNotes.join(" / ")}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function renderAskFallback(input: {
  question: string;
  selectedItems: DigestEntry[];
  comparisonRequested: boolean;
}): string {
  const intro = input.comparisonRequested && input.selectedItems.length >= 2
    ? "저장된 digest 기준으로 비교하면 아래 항목들이 핵심입니다."
    : "저장된 digest 기준으로 질문과 가장 가까운 항목은 아래와 같습니다.";

  return [
    "[Ask]",
    "",
    intro,
    "",
    ...input.selectedItems.map((item) =>
      [
        `[${item.number}] ${item.title}`,
        `요약: ${item.summary}`,
        `왜 중요한지: ${item.whyImportant}`
      ].join("\n")
    ),
    "",
    `근거 항목: ${input.selectedItems.map((item) => item.number).join(", ")}`,
    `출처: ${uniqueStrings(input.selectedItems.map((item) => item.sourceLabel)).join(", ")}`
  ].join("\n\n");
}
