import type { LlmProvider, LlmRunType, LlmTaskTier } from "../types.js";

type UsagePricing = {
  inputUsdPer1MTokens: number;
  cachedInputUsdPer1MTokens?: number;
  outputUsdPer1MTokens: number;
};

type ParsedUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const OPENAI_STANDARD_PRICING: Array<{ prefix: string; pricing: UsagePricing }> = [
  {
    prefix: "gpt-5.4-mini",
    pricing: {
      inputUsdPer1MTokens: 0.75,
      cachedInputUsdPer1MTokens: 0.075,
      outputUsdPer1MTokens: 4.5
    }
  },
  {
    prefix: "gpt-5.4",
    pricing: {
      inputUsdPer1MTokens: 2.5,
      cachedInputUsdPer1MTokens: 0.25,
      outputUsdPer1MTokens: 15
    }
  },
  {
    prefix: "gpt-4.1-mini",
    pricing: {
      inputUsdPer1MTokens: 0.4,
      cachedInputUsdPer1MTokens: 0.1,
      outputUsdPer1MTokens: 1.6
    }
  },
  {
    prefix: "gpt-4.1",
    pricing: {
      inputUsdPer1MTokens: 2,
      cachedInputUsdPer1MTokens: 0.5,
      outputUsdPer1MTokens: 8
    }
  }
];

const WEB_SEARCH_TOOL_USD_PER_CALL = 0.01;

export function inferLlmProvider(modelName: string): LlmProvider {
  const normalized = normalizeModelName(modelName).toLowerCase();

  if (modelName.startsWith("xai:") || normalized.startsWith("grok")) {
    return "xai";
  }

  if (modelName.startsWith("openai:")) {
    return "openai";
  }

  if (
    normalized.startsWith("gpt-") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("computer-use-preview")
  ) {
    return "openai";
  }

  return "unknown";
}

export function resolveLlmTaskTier(runType: LlmRunType, taskKey?: string): LlmTaskTier {
  switch (runType) {
    case "item_enrichment":
    case "followup_answer":
    case "housing_vision":
    case "housing_adjudication":
      return 1;
    case "theme_synthesis":
      return taskKey?.endsWith(".pm") ? 2 : 1;
    case "followup_research":
      return 3;
    default:
      return 1;
  }
}

export function estimateLlmUsageCostUsd(input: {
  provider: LlmProvider;
  modelName: string;
  usage?: Record<string, unknown> | null;
  webSearchCalls?: number;
}): number | null {
  const parsedUsage = parseUsage(input.usage);
  const pricing = resolveUsagePricing(input.provider, input.modelName);
  const webSearchCalls = Math.max(0, input.webSearchCalls ?? 0);

  if (!pricing && webSearchCalls === 0) {
    return null;
  }

  let total = 0;

  if (parsedUsage && pricing) {
    const uncachedInputTokens = Math.max(0, parsedUsage.inputTokens - parsedUsage.cachedInputTokens);
    total += (uncachedInputTokens / 1_000_000) * pricing.inputUsdPer1MTokens;
    total +=
      (parsedUsage.cachedInputTokens / 1_000_000) * (pricing.cachedInputUsdPer1MTokens ?? pricing.inputUsdPer1MTokens);
    total += (parsedUsage.outputTokens / 1_000_000) * pricing.outputUsdPer1MTokens;
  }

  if (webSearchCalls > 0) {
    total += webSearchCalls * WEB_SEARCH_TOOL_USD_PER_CALL;
  }

  return Number(total.toFixed(8));
}

export function normalizeModelName(modelName: string): string {
  const trimmed = modelName.trim();
  const colonIndex = trimmed.indexOf(":");
  return colonIndex >= 0 ? trimmed.slice(colonIndex + 1) : trimmed;
}

function resolveUsagePricing(provider: LlmProvider, modelName: string): UsagePricing | null {
  if (provider !== "openai") {
    return null;
  }

  const normalized = normalizeModelName(modelName).toLowerCase();

  for (const candidate of OPENAI_STANDARD_PRICING) {
    if (normalized === candidate.prefix || normalized.startsWith(`${candidate.prefix}-`)) {
      return candidate.pricing;
    }
  }

  return null;
}

function parseUsage(usage?: Record<string, unknown> | null): ParsedUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens);
  const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  const cachedInputTokens =
    readNumber(readRecord(usage.input_tokens_details)?.cached_tokens) ??
    readNumber(readRecord(usage.prompt_tokens_details)?.cached_tokens) ??
    0;

  if (inputTokens == null && outputTokens == null && totalTokens == null) {
    return null;
  }

  const resolvedInputTokens = Math.max(inputTokens ?? 0, cachedInputTokens);
  const resolvedOutputTokens = outputTokens ?? Math.max(0, (totalTokens ?? 0) - resolvedInputTokens);
  const resolvedTotalTokens = totalTokens ?? resolvedInputTokens + resolvedOutputTokens;

  return {
    inputTokens: resolvedInputTokens,
    cachedInputTokens: Math.min(cachedInputTokens, resolvedInputTokens),
    outputTokens: resolvedOutputTokens,
    totalTokens: resolvedTotalTokens
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
