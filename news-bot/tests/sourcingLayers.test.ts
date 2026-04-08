import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { NewsDatabase } from "../src/db.js";
import { buildDigest } from "../src/digest/buildDigest.js";
import { extractBlueskySignalEvents } from "../src/sources/blueskySignals.js";
import { normalizeHackerNewsItem } from "../src/sources/hackerNews.js";
import { parseTechmemeHomepage } from "../src/sources/techmeme.js";
import type { AppConfig } from "../src/config.js";
import type { SourceItemInput } from "../src/types.js";

const FIXTURE_DIR = path.resolve(process.cwd(), "tests/fixtures");
const NOW = DateTime.fromISO("2026-03-27T10:00:00-04:00");
const FETCHED_AT = NOW.toUTC().toISO() ?? new Date().toISOString();

describe("sourcing layers", () => {
  it("parses Techmeme homepage clusters into precision items", () => {
    const html = readFixture("techmeme-home.html");
    const items = parseTechmemeHomepage(html, "https://www.techmeme.com", FETCHED_AT);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceType: "techmeme",
      sourceLayer: "precision",
      sourceLabel: "Techmeme / Lead"
    });
    expect(items[0].sourceUrl).toContain("https://www.techmeme.com/260327/p1#a260327p1");
    expect(items[1].sourceLabel).toBe("Techmeme / Related");
  });

  it("normalizes Hacker News stories into precision candidates", () => {
    const payload = JSON.parse(readFixture("hacker-news-item.json"));
    const item = normalizeHackerNewsItem(payload, FETCHED_AT, {
      topSet: new Set([payload.id]),
      newSet: new Set<number>()
    });

    expect(item).toMatchObject({
      sourceType: "hacker_news",
      sourceLayer: "precision",
      sourceLabel: "Hacker News / Top"
    });
    expect(item?.canonicalUrl).toBe("https://blog.example.com/agent-runtime-patterns");
  });

  it("extracts Bluesky social signals and preserves the primary external link", () => {
    const response = JSON.parse(readFixture("bluesky-feed.json"));
    const events = extractBlueskySignalEvents(response, { label: "Techmeme", handle: "techmeme.com" }, FETCHED_AT);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceId: "bluesky_watch",
      sourceLayer: "early_warning",
      actorLabel: "Techmeme",
      linkedUrl: "https://blog.example.com/agent-runtime-patterns"
    });
    expect(events[0].postUrl).toContain("https://bsky.app/profile/techmeme.com/post/");
  });

  it("merges official, Techmeme, Hacker News, and GeekNews sightings into one story", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();

    try {
      for (const item of mergedStoryInputs()) {
        db.upsertNormalizedItem(item);
      }

      const digest = buildDigest({ db, config, profileKey: "tech", mode: "am", now: NOW });
      const entry = digest.items.find((item) => item.title.includes("Introducing Agent Runtime Patterns"));

      expect(entry).toBeTruthy();
      expect(entry?.sourceLinks).toHaveLength(1);
      expect(entry?.sourceLinks[0]?.label).toContain("OpenAI / Product");
      expect(entry?.sourceLinks[0]?.label).toContain("Techmeme / Lead");
      expect(entry?.sourceLinks[0]?.label).toContain("Hacker News / Top");
      expect(entry?.sourceLinks[0]?.label).toContain("GeekNews / News");
      expect(entry?.scoreReasons.some((reason) => reason.includes("Techmeme"))).toBe(true);
      expect(entry?.scoreReasons.some((reason) => reason.includes("HN"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("lets a Techmeme-only AI article become a digest candidate", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();

    try {
      db.upsertNormalizedItem({
        sourceId: "techmeme",
        sourceType: "techmeme",
        sourceLayer: "precision",
        sourceLabel: "Techmeme / Lead",
        sourceAuthority: 68,
        externalId: "260327p2",
        title: "MCP orchestration stack becomes a new developer default",
        description: "A deep dive into MCP orchestration, evals, browser automation, and coding agents.",
        contentText: "A deep dive into MCP orchestration, evals, browser automation, and coding agents.",
        sourceUrl: "https://www.techmeme.com/260327/p2#a260327p2",
        canonicalUrl: "https://blog.example.com/mcp-orchestration-default",
        originalUrl: "https://blog.example.com/mcp-orchestration-default",
        publishedAt: FETCHED_AT,
        fetchedAt: FETCHED_AT,
        itemKind: "news"
      });

      const digest = buildDigest({ db, config, profileKey: "tech", mode: "am", now: NOW });
      expect(digest.items.some((item) => item.title.includes("MCP orchestration stack"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("adds matched Bluesky signals without creating standalone digest items", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig({ blueskyEnabled: true });

    try {
      db.upsertNormalizedItem(mergedStoryInputs()[0]);
      db.saveSignalEvents([
        {
          sourceId: "bluesky_watch",
          sourceLayer: "early_warning",
          actorLabel: "Techmeme",
          actorHandle: "techmeme.com",
          postUrl: "https://bsky.app/profile/techmeme.com/post/3abc",
          linkedUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
          title: "Agent runtime patterns are becoming the new baseline",
          excerpt: "Agent runtime patterns are becoming the new baseline",
          fetchedAt: FETCHED_AT
        }
      ]);
      db.matchRecentSignalEvents(NOW.minus({ hours: 48 }).toUTC().toISO() ?? FETCHED_AT);

      const digest = buildDigest({ db, config, profileKey: "tech", mode: "am", now: NOW });
      expect(digest.items).toHaveLength(1);
      expect(digest.items[0].signalLinks).toEqual([
        {
          label: "Techmeme / Bluesky",
          url: "https://bsky.app/profile/techmeme.com/post/3abc"
        }
      ]);
      expect(digest.items[0].scoreReasons.some((reason) => reason.includes("Bluesky signal"))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("stores no-link Bluesky posts as research hints without affecting ranking", () => {
    const db = new NewsDatabase(":memory:");

    try {
      db.saveSignalEvents([
        {
          sourceId: "bluesky_watch",
          sourceLayer: "early_warning",
          actorLabel: "Techmeme",
          actorHandle: "techmeme.com",
          postUrl: "https://bsky.app/profile/techmeme.com/post/3nolink",
          title: "Interesting AI chatter today",
          excerpt: "Interesting AI chatter today",
          fetchedAt: FETCHED_AT
        }
      ]);
      db.matchRecentSignalEvents(NOW.minus({ hours: 48 }).toUTC().toISO() ?? FETCHED_AT);

      const unmatched = db.listUnmatchedSignalEvents(5);
      expect(unmatched).toHaveLength(1);
      expect(unmatched[0].linkedUrl).toBeNull();
      expect(db.listCandidateItems("tech", NOW.minus({ hours: 72 }).toUTC().toISO() ?? FETCHED_AT)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

function readFixture(fileName: string): string {
  return fs.readFileSync(path.join(FIXTURE_DIR, fileName), "utf8");
}

function makeConfig(overrides?: { blueskyEnabled?: boolean }): AppConfig {
  const config = loadConfig(process.cwd());
  return {
    ...config,
    llm: {
      ...config.llm,
      enabled: false,
      themesEnabled: false,
      rerankEnabled: false
    },
    sourcing: {
      ...config.sourcing,
      blueskyEnabled: overrides?.blueskyEnabled ?? false
    }
  };
}

function mergedStoryInputs(): SourceItemInput[] {
  return [
    {
      sourceId: "openai_news",
      sourceType: "openai_official",
      sourceLayer: "primary",
      sourceLabel: "OpenAI / Product",
      sourceAuthority: 100,
      externalId: "https://openai.com/index/introducing-agent-runtime-patterns",
      title: "Introducing Agent Runtime Patterns",
      description: "OpenAI explains agent runtime patterns for Responses API, tools, memory, and browser automation.",
      contentText: "OpenAI explains agent runtime patterns for Responses API, tools, memory, and browser automation.",
      sourceUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      canonicalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      originalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "product",
      openaiCategory: "Product"
    },
    {
      sourceId: "techmeme",
      sourceType: "techmeme",
      sourceLayer: "precision",
      sourceLabel: "Techmeme / Lead",
      sourceAuthority: 68,
      externalId: "260327p1",
      title: "Introducing Agent Runtime Patterns",
      description: "Techmeme cluster tracking the OpenAI agent runtime patterns announcement.",
      contentText: "Techmeme cluster tracking the OpenAI agent runtime patterns announcement.",
      sourceUrl: "https://www.techmeme.com/260327/p1#a260327p1",
      canonicalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      originalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news"
    },
    {
      sourceId: "hacker_news",
      sourceType: "hacker_news",
      sourceLayer: "precision",
      sourceLabel: "Hacker News / Top",
      sourceAuthority: 60,
      externalId: "12345",
      title: "Introducing Agent Runtime Patterns",
      description: "HN discussion around OpenAI agent runtime patterns and coding workflows.",
      contentText: "HN discussion around OpenAI agent runtime patterns and coding workflows.",
      sourceUrl: "https://news.ycombinator.com/item?id=12345",
      canonicalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      originalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news",
      metadata: {
        score: 840,
        comments: 212
      },
      rawPayload: {
        id: 12345,
        score: 840,
        descendants: 212
      }
    },
    {
      sourceId: "geeknews",
      sourceType: "geeknews",
      sourceLayer: "precision",
      sourceLabel: "GeekNews / News",
      sourceAuthority: 62,
      externalId: "27902",
      title: "Introducing Agent Runtime Patterns",
      description: "GeekNews discussion around agent runtime patterns and MCP workflows.",
      contentText: "GeekNews discussion around agent runtime patterns and MCP workflows.",
      sourceUrl: "https://news.hada.io/topic?id=27902",
      canonicalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      originalUrl: "https://openai.com/index/introducing-agent-runtime-patterns",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news",
      geeknewsKind: "news"
    }
  ];
}
