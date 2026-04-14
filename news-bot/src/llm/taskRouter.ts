import type { AppConfig } from "../config.js";
import type { LlmProvider, LlmRunType, LlmTaskKey, LlmTaskTier } from "../types.js";

export interface RoutedLlmTask {
  enabled: boolean;
  taskKey: LlmTaskKey;
  runType: LlmRunType;
  tier: LlmTaskTier;
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  allowSilentFallback: boolean;
  skipReason?: string;
}

interface RouteTaskInput {
  config: AppConfig;
  taskKey: LlmTaskKey;
  spentTodayUsd?: number | null;
}

const TASK_RUN_TYPES: Record<LlmTaskKey, LlmRunType> = {
  item_enrichment: "item_enrichment",
  theme_synthesis_am: "theme_synthesis",
  theme_synthesis_pm: "theme_synthesis",
  followup_answer: "followup_answer",
  followup_research: "followup_research"
};

const TASK_TIERS: Record<LlmTaskKey, LlmTaskTier> = {
  item_enrichment: 1,
  theme_synthesis_am: 1,
  theme_synthesis_pm: 2,
  followup_answer: 1,
  followup_research: 3
};

const TASK_FALLBACKS: Record<LlmTaskKey, boolean> = {
  item_enrichment: true,
  theme_synthesis_am: true,
  theme_synthesis_pm: true,
  followup_answer: true,
  followup_research: false
};

const PRICE_BOOK: Record<string, { input: number; output: number; cachedInput?: number }> = {
  "xai:grok-4-1-fast-reasoning": { input: 0.2, output: 0.5 },
  "openai:gpt-4.1": { input: 2, output: 8, cachedInput: 0.5 },
  "openai:gpt-5.4-mini": { input: 0.75, output: 4.5, cachedInput: 0.075 },
  "openai:gpt-4.1-mini": { input: 0.4, output: 1.6, cachedInput: 0.1 }
};

export function routeLlmTask(input: RouteTaskInput): RoutedLlmTask {
  const tier = TASK_TIERS[input.taskKey];
  const runType = TASK_RUN_TYPES[input.taskKey];
  const allowSilentFallback = TASK_FALLBACKS[input.taskKey];
  const spentTodayUsd = input.spentTodayUsd ?? 0;

  if (!input.config.llm.enabled) {
    return disabledRoute(input.taskKey, runType, tier, allowSilentFallback, "llm disabled");
  }

  if (tier > input.config.llm.maxAllowedTier) {
    return disabledRoute(input.taskKey, runType, tier, allowSilentFallback, "tier blocked by config");
  }

  if (
    input.config.llm.dailyBudgetUsd != null &&
    spentTodayUsd >= input.config.llm.dailyBudgetUsd &&
    (input.config.llm.budgetHardStop || tier >= 2)
  ) {
    return disabledRoute(input.taskKey, runType, tier, allowSilentFallback, "daily llm budget reached");
  }

  const rawModel = resolveTierModel(input.config, tier);
  const parsed = parseProviderModel(rawModel);
  const apiKey = parsed.provider === "xai" ? input.config.xAiApiKey : input.config.openAiApiKey;

  if (input.taskKey === "followup_research" && parsed.provider !== "openai") {
    return disabledRoute(input.taskKey, runType, tier, allowSilentFallback, "followup_research requires openai web search");
  }

  if (!apiKey) {
    return disabledRoute(input.taskKey, runType, tier, allowSilentFallback, `${parsed.provider} api key missing`);
  }

  return {
    enabled: true,
    taskKey: input.taskKey,
    runType,
    tier,
    provider: parsed.provider,
    model: parsed.model,
    apiKey,
    timeoutMs: resolveTierTimeout(input.config, tier),
    allowSilentFallback
  };
}

function disabledRoute(
  taskKey: LlmTaskKey,
  runType: LlmRunType,
  tier: LlmTaskTier,
  allowSilentFallback: boolean,
  skipReason: string
): RoutedLlmTask {
  return {
    enabled: false,
    taskKey,
    runType,
    tier,
    provider: "openai",
    model: "",
    timeoutMs: 0,
    allowSilentFallback,
    skipReason
  };
}

function resolveTierModel(config: AppConfig, tier: LlmTaskTier): string {
  if (tier <= 1) {
    return config.llm.modelTierSmall;
  }
  if (tier === 2) {
    return config.llm.modelTierMedium;
  }
  return config.llm.modelTierDeep;
}

function resolveTierTimeout(config: AppConfig, tier: LlmTaskTier): number {
  if (tier <= 1) {
    return config.llm.timeoutTierSmallMs;
  }
  if (tier === 2) {
    return config.llm.timeoutTierMediumMs;
  }
  return config.llm.timeoutTierDeepMs;
}

export function parseProviderModel(input: string): { provider: LlmProvider; model: string; qualifiedModel: string } {
  const trimmed = input.trim();
  if (!trimmed.includes(":")) {
    return {
      provider: "openai",
      model: trimmed,
      qualifiedModel: `openai:${trimmed}`
    };
  }

  const [provider, ...rest] = trimmed.split(":");
  const model = rest.join(":").trim();
  if ((provider === "openai" || provider === "xai") && model.length > 0) {
    return {
      provider,
      model,
      qualifiedModel: `${provider}:${model}`
    };
  }

  throw new Error(`Unsupported provider-qualified model: ${input}`);
}

export function estimateLlmCostUsd(input: {
  provider: LlmProvider;
  model: string;
  usage?: Record<string, unknown> | null;
}): number | null {
  if (!input.usage) {
    return null;
  }

  const qualifiedModel = `${input.provider}:${input.model}`;
  const pricing = PRICE_BOOK[qualifiedModel];
  if (!pricing) {
    return null;
  }

  const promptTokens = numberFromUsage(input.usage.prompt_tokens) ?? numberFromUsage(input.usage.input_tokens) ?? 0;
  const completionTokens =
    numberFromUsage(input.usage.completion_tokens) ?? numberFromUsage(input.usage.output_tokens) ?? 0;
  const cachedPromptTokens =
    numberFromUsage(
      (input.usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens
    ) ??
    numberFromUsage((input.usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens) ??
    0;
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);
  const inputRate = pricing.input / 1_000_000;
  const outputRate = pricing.output / 1_000_000;
  const cachedRate = (pricing.cachedInput ?? pricing.input) / 1_000_000;
  const total = uncachedPromptTokens * inputRate + cachedPromptTokens * cachedRate + completionTokens * outputRate;
  return Number(total.toFixed(8));
}

function numberFromUsage(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
