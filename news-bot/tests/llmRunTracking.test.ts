import { describe, expect, it } from "vitest";
import { NewsDatabase } from "../src/db.js";
import { estimateLlmUsageCostUsd, inferLlmProvider, resolveLlmTaskTier } from "../src/llm/runTelemetry.js";

describe("llm run telemetry", () => {
  it("estimates OpenAI token cost without extra model calls", () => {
    const cost = estimateLlmUsageCostUsd({
      provider: "openai",
      modelName: "gpt-4.1-mini",
      usage: {
        prompt_tokens: 1_000,
        completion_tokens: 500,
        total_tokens: 1_500,
        prompt_tokens_details: {
          cached_tokens: 200
        }
      }
    });

    expect(cost).toBeCloseTo(0.00114, 8);
  });

  it("stores provider, task tier, token usage, and estimated cost in llm_runs", () => {
    const db = new NewsDatabase(":memory:");

    try {
      const runId = db.startLlmRun({
        profileKey: "tech",
        runType: "theme_synthesis",
        taskKey: "digest_theme_synthesis.pm",
        taskTier: resolveLlmTaskTier("theme_synthesis", "digest_theme_synthesis.pm"),
        provider: inferLlmProvider("gpt-4.1"),
        modelName: "gpt-4.1",
        promptVersion: "theme_v1",
        inputHash: "hash-123",
        startedAt: "2026-04-15T00:00:00Z"
      });

      const usage = {
        input_tokens: 2_000,
        output_tokens: 600,
        total_tokens: 2_600
      };

      db.finishLlmRun({
        runId,
        status: "ok",
        completedAt: "2026-04-15T00:00:02Z",
        latencyMs: 2_000,
        tokenUsage: usage,
        estimatedCostUsd: estimateLlmUsageCostUsd({
          provider: "openai",
          modelName: "gpt-4.1",
          usage
        })
      });

      const runs = db.listRecentLlmRuns("tech", 10);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        runType: "theme_synthesis",
        taskKey: "digest_theme_synthesis.pm",
        taskTier: 2,
        provider: "openai",
        modelName: "gpt-4.1",
        promptVersion: "theme_v1",
        latencyMs: 2_000,
        status: "ok"
      });
      expect(runs[0].tokenUsage).toEqual(usage);
      expect(runs[0].estimatedCostUsd).toBeCloseTo(0.0088, 8);
    } finally {
      db.close();
    }
  });
});
