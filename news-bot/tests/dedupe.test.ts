import { describe, expect, it } from "vitest";
import { NewsDatabase } from "../src/db.js";
import type { SourceItemInput } from "../src/types.js";

function makeBaseItem(overrides: Partial<SourceItemInput> = {}): SourceItemInput {
  return {
    sourceId: "openai_news",
    sourceType: "openai_official",
    sourceLabel: "OpenAI / Product",
    sourceAuthority: 100,
    externalId: "https://openai.com/index/introducing-gpt-5-4",
    title: "Introducing GPT-5.4",
    description: "New frontier model for coding and tool use.",
    contentText: "New frontier model for coding and tool use.",
    sourceUrl: "https://openai.com/index/introducing-gpt-5-4",
    canonicalUrl: "https://openai.com/index/introducing-gpt-5-4",
    originalUrl: "https://openai.com/index/introducing-gpt-5-4",
    publishedAt: "2026-03-27T10:00:00Z",
    fetchedAt: "2026-03-27T10:05:00Z",
    itemKind: "product",
    openaiCategory: "Product",
    ...overrides
  };
}

describe("dedupe + source merge", () => {
  it("merges canonical duplicates and preserves multiple source records", () => {
    const db = new NewsDatabase(":memory:");
    const first = db.upsertNormalizedItem(makeBaseItem());
    const second = db.upsertNormalizedItem(
      makeBaseItem({
        sourceId: "geeknews",
        sourceType: "geeknews",
        sourceLabel: "GeekNews / News",
        sourceAuthority: 62,
        externalId: "27950",
        sourceUrl: "https://news.hada.io/topic?id=27950",
        canonicalUrl: "https://openai.com/index/introducing-gpt-5-4?utm_source=hn",
        originalUrl: "https://openai.com/index/introducing-gpt-5-4?utm_source=hn",
        itemKind: "news"
      })
    );

    expect(second.id).toBe(first.id);
    expect(second.sources).toHaveLength(2);
    expect(second.canonicalUrl).toBe("https://openai.com/index/introducing-gpt-5-4");
    db.close();
  });
});
