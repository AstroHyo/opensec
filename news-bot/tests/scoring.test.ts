import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { scoreItem } from "../src/scoring.js";
import type { NormalizedItemRecord } from "../src/types.js";

function makeItem(overrides: Partial<NormalizedItemRecord>): NormalizedItemRecord {
  return {
    id: 1,
    canonicalUrl: "https://example.com/item",
    title: "Base Item",
    normalizedTitle: "base item",
    titleHash: "hash",
    sourceType: "github_trending",
    primarySourceLayer: "primary",
    primarySourceId: "github_trending",
    primarySourceLabel: "GitHub Trending / overall",
    sourceAuthority: 74,
    sourceLabels: ["GitHub Trending / overall"],
    publishedAt: "2026-03-27T13:00:00Z",
    firstSeenAt: "2026-03-27T13:10:00Z",
    lastSeenAt: "2026-03-27T13:10:00Z",
    lastUpdatedAt: "2026-03-27T13:10:00Z",
    itemKind: "repo",
    openaiCategory: null,
    geeknewsKind: null,
    repoOwner: "example",
    repoName: "repo",
    repoLanguage: "Python",
    repoStarsToday: 1200,
    repoStarsTotal: 8000,
    description: "Agent orchestration toolkit for MCP and browser automation workflows.",
    contentText: "Agent orchestration toolkit for MCP and browser automation workflows.",
    sourceUrl: "https://github.com/trending",
    originalUrl: "https://github.com/example/repo",
    metadata: {},
    keywords: [],
    lastSentAt: null,
    crossSignalCount: 1,
    sources: [],
    matchedSignals: [],
    ...overrides
  };
}

describe("scoring", () => {
  it("prioritizes fresh official OpenAI items above weaker community chatter", () => {
    const now = DateTime.fromISO("2026-03-27T14:00:00Z");
    const official = scoreItem(
      makeItem({
        sourceType: "openai_official",
        primarySourceId: "openai_news",
        primarySourceLabel: "OpenAI / Product",
        sourceAuthority: 100,
        title: "Introducing GPT-5.4 mini and nano",
        itemKind: "product",
        openaiCategory: "Product",
        description: "Smaller, faster models optimized for coding and tool use.",
        contentText: "Smaller, faster models optimized for coding and tool use."
      }),
      {
        profileKey: "tech",
        mode: "am",
        now,
        windowStart: now.minus({ hours: 4 }),
        windowEnd: now,
        resendHours: 72
      }
    );

    const weakGeekNews = scoreItem(
      makeItem({
        sourceType: "geeknews",
        primarySourceId: "geeknews",
        primarySourceLabel: "GeekNews / Ask",
        sourceAuthority: 62,
        title: "Ask GN: Best office chair?",
        itemKind: "ask",
        geeknewsKind: "ask",
        description: "Looking for chair recommendations.",
        contentText: "Looking for chair recommendations."
      }),
      {
        profileKey: "tech",
        mode: "am",
        now,
        windowStart: now.minus({ hours: 4 }),
        windowEnd: now,
        resendHours: 72
      }
    );

    expect(official.total).toBeGreaterThan(weakGeekNews.total);
    expect(weakGeekNews.suppressed).toBe(true);
  });

  it("filters weak trending repos that are not actually AI/tooling relevant", () => {
    const now = DateTime.fromISO("2026-03-27T14:00:00Z");
    const relevant = scoreItem(makeItem({}), {
      profileKey: "tech",
      mode: "pm",
      now,
      windowStart: now.minus({ hours: 8 }),
      windowEnd: now,
      resendHours: 72
    });

    const irrelevant = scoreItem(
      makeItem({
        title: "retro-wallpaper-lab/ui-screens",
        description: "Beautiful CSS wallpapers and nostalgic gradient themes for your browser homepage.",
        contentText: "Beautiful CSS wallpapers and nostalgic gradient themes for your browser homepage."
      }),
      {
        profileKey: "tech",
        mode: "pm",
        now,
        windowStart: now.minus({ hours: 8 }),
        windowEnd: now,
        resendHours: 72
      }
    );

    expect(relevant.suppressed).toBe(false);
    expect(irrelevant.suppressed).toBe(true);
  });
});
