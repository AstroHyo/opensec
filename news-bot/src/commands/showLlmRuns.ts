import path from "node:path";
import { loadConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import type { LlmRunRecord, ProfileKey } from "../types.js";

export async function runLlmRunsCommand(input: {
  profileKey: ProfileKey;
  dbPathOverride?: string;
  limit?: number;
}): Promise<string> {
  const config = loadConfig(process.cwd());
  const dbPath = input.dbPathOverride ? path.resolve(process.cwd(), input.dbPathOverride) : config.dbPath;
  const db = new NewsDatabase(dbPath);

  try {
    const runs = db.listRecentLlmRuns(input.profileKey, clampLimit(input.limit));

    if (runs.length === 0) {
      return "No LLM runs recorded yet.";
    }

    return [
      `[LLM Runs | profile=${input.profileKey}]`,
      "",
      ...runs.map(renderLlmRun)
    ].join("\n");
  } finally {
    db.close();
  }
}

function renderLlmRun(run: LlmRunRecord): string {
  const tokenSummary = summarizeTokens(run.tokenUsage);

  return [
    `#${run.id} ${run.startedAt}`,
    `- task=${run.taskKey ?? run.runType} | tier=${run.taskTier ?? "?"} | provider=${run.provider ?? "unknown"} | model=${run.modelName}`,
    `- status=${run.status} | latency_ms=${run.latencyMs ?? "?"} | est_cost_usd=${formatUsd(run.estimatedCostUsd)}`,
    tokenSummary ? `- usage=${tokenSummary}` : null,
    run.errorText ? `- error=${run.errorText}` : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function summarizeTokens(usage?: Record<string, unknown> | null): string | null {
  if (!usage) {
    return null;
  }

  const inputTokens = readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens);
  const outputTokens = readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  const cachedTokens =
    readNumber(readRecord(usage.input_tokens_details)?.cached_tokens) ??
    readNumber(readRecord(usage.prompt_tokens_details)?.cached_tokens);

  const parts = [
    inputTokens != null ? `input=${inputTokens}` : null,
    cachedTokens != null ? `cached=${cachedTokens}` : null,
    outputTokens != null ? `output=${outputTokens}` : null,
    totalTokens != null ? `total=${totalTokens}` : null
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(", ") : null;
}

function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 20;
  }

  return Math.min(100, Math.max(1, Math.floor(limit)));
}

function formatUsd(value?: number | null): string {
  if (value == null) {
    return "n/a";
  }

  return value.toFixed(value >= 0.01 ? 4 : 6);
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
