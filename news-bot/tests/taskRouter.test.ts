import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { estimateLlmCostUsd, routeLlmTask } from "../src/llm/taskRouter.js";
import type { AppConfig } from "../src/config.js";

describe("task router", () => {
  it("routes item enrichment to tier 1 xAI by default", () => {
    const config = makeConfig();

    const route = routeLlmTask({
      config,
      taskKey: "item_enrichment",
      spentTodayUsd: 0
    });

    expect(route.enabled).toBe(true);
    expect(route.tier).toBe(1);
    expect(route.provider).toBe("xai");
    expect(route.model).toBe("grok-4-1-fast-reasoning");
  });

  it("routes PM theme synthesis to tier 2 OpenAI", () => {
    const config = makeConfig();

    const route = routeLlmTask({
      config,
      taskKey: "theme_synthesis_pm",
      spentTodayUsd: 0
    });

    expect(route.enabled).toBe(true);
    expect(route.tier).toBe(2);
    expect(route.provider).toBe("openai");
    expect(route.model).toBe("gpt-4.1");
  });

  it("blocks higher tiers after the daily budget is reached while still allowing tier 1", () => {
    const config = makeConfig({
      llm: {
        ...loadConfig(process.cwd()).llm,
        enabled: true,
        themesEnabled: true,
        rerankEnabled: false,
        dailyBudgetUsd: 0.05,
        budgetHardStop: false
      }
    });

    const mediumRoute = routeLlmTask({
      config,
      taskKey: "theme_synthesis_pm",
      spentTodayUsd: 0.05
    });
    const smallRoute = routeLlmTask({
      config,
      taskKey: "followup_answer",
      spentTodayUsd: 0.05
    });

    expect(mediumRoute.enabled).toBe(false);
    expect(mediumRoute.skipReason).toContain("daily llm budget");
    expect(smallRoute.enabled).toBe(true);
  });

  it("estimates cost from provider pricing and usage fields", () => {
    const cost = estimateLlmCostUsd({
      provider: "xai",
      model: "grok-4-1-fast-reasoning",
      usage: {
        prompt_tokens: 12_000,
        completion_tokens: 1_000
      }
    });

    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
    expect(cost!).toBeLessThan(0.01);
  });
});

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  process.env.OPENAI_API_KEY = "openai-test";
  process.env.XAI_API_KEY = "xai-test";
  process.env.NEWS_BOT_LLM_ENABLED = "true";
  const config = loadConfig(process.cwd());
  return {
    ...config,
    ...overrides,
    llm: {
      ...config.llm,
      enabled: true,
      themesEnabled: true,
      rerankEnabled: false,
      ...(overrides?.llm ?? {})
    }
  };
}
