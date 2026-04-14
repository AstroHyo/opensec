import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { NewsDatabase } from "../src/db.js";
import { buildDigest } from "../src/digest/buildDigest.js";
import type { AppConfig } from "../src/config.js";
import type { SourceItemInput } from "../src/types.js";

describe("strong 72h suppression", () => {
  it("blocks the same repo from reappearing through a different source path within 72 hours", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();
    const firstNow = DateTime.fromISO("2026-04-14T09:30:00-04:00");
    const secondNow = firstNow.plus({ hours: 10 });

    try {
      db.upsertNormalizedItem(repoSource({
        sourceId: "github_trending",
        sourceType: "github_trending",
        sourceLabel: "GitHub Trending / python",
        canonicalUrl: "https://github.com/example/mcp-orbit",
        sourceUrl: "https://github.com/trending/python",
        originalUrl: "https://github.com/example/mcp-orbit",
        fetchedAt: firstNow.toUTC().toISO() ?? new Date().toISOString(),
        publishedAt: firstNow.minus({ hours: 1 }).toUTC().toISO() ?? new Date().toISOString(),
        externalId: "python:example/mcp-orbit"
      }));

      const firstDigest = buildDigest({
        db,
        config,
        profileKey: "tech",
        mode: "am",
        now: firstNow
      });
      expect(firstDigest.items).toHaveLength(1);
      db.saveDigest("tech", firstDigest, firstNow.toUTC().toISO() ?? new Date().toISOString());

      db.upsertNormalizedItem(repoSource({
        sourceId: "github_trending",
        sourceType: "github_trending",
        sourceLabel: "GitHub Trending / typescript",
        canonicalUrl: "https://blog.example.com/mcp-orbit-v2-release",
        sourceUrl: "https://github.com/trending/typescript",
        originalUrl: "https://blog.example.com/mcp-orbit-v2-release",
        fetchedAt: secondNow.toUTC().toISO() ?? new Date().toISOString(),
        publishedAt: secondNow.minus({ hours: 1 }).toUTC().toISO() ?? new Date().toISOString(),
        externalId: "typescript:example/mcp-orbit-v2",
        title: "MCP Orbit v2 release for agent orchestration",
        description: "A second feed path points at the same repo with updated release messaging.",
        contentText: "A second feed path points at the same repo with updated release messaging."
      }));

      const secondDigest = buildDigest({
        db,
        config,
        profileKey: "tech",
        mode: "pm",
        now: secondNow
      });

      expect(secondDigest.items).toHaveLength(0);
      expect(secondDigest.stats.suppressedRecentDuplicates).toBe(1);
    } finally {
      db.close();
    }
  });

  it("allows a materially updated OpenAI official item to resurface inside 72 hours", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();
    const firstNow = DateTime.fromISO("2026-04-14T09:30:00-04:00");
    const secondNow = firstNow.plus({ hours: 8 });
    const canonicalUrl = "https://openai.com/news/product-releases/runtime-update";

    try {
      db.upsertNormalizedItem(openAiSource({
        canonicalUrl,
        fetchedAt: firstNow.toUTC().toISO() ?? new Date().toISOString(),
        publishedAt: firstNow.minus({ hours: 2 }).toUTC().toISO() ?? new Date().toISOString(),
        description: "OpenAI ships the first runtime preview."
      }));

      const firstDigest = buildDigest({
        db,
        config,
        profileKey: "tech",
        mode: "am",
        now: firstNow
      });
      expect(firstDigest.items).toHaveLength(1);
      db.saveDigest("tech", firstDigest, firstNow.toUTC().toISO() ?? new Date().toISOString());

      db.upsertNormalizedItem(openAiSource({
        canonicalUrl,
        fetchedAt: secondNow.toUTC().toISO() ?? new Date().toISOString(),
        publishedAt: secondNow.minus({ hours: 1 }).toUTC().toISO() ?? new Date().toISOString(),
        description: "OpenAI updates the runtime preview with hosted containers and shell execution details.",
        contentText: "OpenAI updates the runtime preview with hosted containers and shell execution details."
      }));

      const secondDigest = buildDigest({
        db,
        config,
        profileKey: "tech",
        mode: "pm",
        now: secondNow
      });

      expect(secondDigest.items).toHaveLength(1);
      expect(secondDigest.items[0]?.sourceType).toBe("openai_official");
    } finally {
      db.close();
    }
  });
});

function makeConfig(): AppConfig {
  const config = loadConfig(process.cwd());
  return {
    ...config,
    llm: {
      ...config.llm,
      enabled: false,
      themesEnabled: false,
      rerankEnabled: false
    }
  };
}

function repoSource(input: Partial<SourceItemInput> & Pick<SourceItemInput, "externalId" | "sourceId" | "sourceType" | "sourceLabel" | "canonicalUrl" | "sourceUrl" | "fetchedAt" | "publishedAt">): SourceItemInput {
  return {
    sourceAuthority: 78,
    title: "example/mcp-orbit",
    description: "Agent orchestration repo focused on MCP workflows.",
    contentText: "Agent orchestration repo focused on MCP workflows.",
    originalUrl: input.originalUrl,
    itemKind: "repo",
    repoOwner: "example",
    repoName: "mcp-orbit",
    repoLanguage: "TypeScript",
    repoStarsToday: 420,
    repoStarsTotal: 8_000,
    keywords: ["MCP", "agents", "developer tooling"],
    metadata: {},
    ...input
  };
}

function openAiSource(input: {
  canonicalUrl: string;
  fetchedAt: string;
  publishedAt: string;
  description: string;
  contentText?: string;
}): SourceItemInput {
  return {
    sourceId: "openai_news",
    sourceType: "openai_official",
    sourceLayer: "primary",
    sourceLabel: "OpenAI / Product Releases",
    sourceAuthority: 96,
    externalId: input.canonicalUrl,
    title: "Runtime update",
    description: input.description,
    contentText: input.contentText ?? input.description,
    sourceUrl: input.canonicalUrl,
    canonicalUrl: input.canonicalUrl,
    originalUrl: input.canonicalUrl,
    publishedAt: input.publishedAt,
    fetchedAt: input.fetchedAt,
    itemKind: "product",
    openaiCategory: "Product",
    keywords: ["OpenAI", "agents", "runtime"],
    metadata: {}
  };
}
