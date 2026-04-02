import { afterEach, describe, expect, it, vi } from "vitest";
import { generateStructuredJson } from "../src/llm/openaiClient.js";
import { applyItemEnrichment, buildDigestThemeCacheKey } from "../src/llm/enrichDigest.js";
import { digestThemeJsonSchema, digestThemeSchema } from "../src/llm/schemas.js";
import type { DigestBuildResult, DigestEntry, ItemEnrichmentRecord } from "../src/types.js";

describe("openai structured output parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a strict JSON response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    themes_ko: ["OpenAI와 agent tooling이 실행 가능한 workflow에 더 가까워지고 있습니다."]
                  })
                }
              }
            ],
            usage: {
              total_tokens: 123
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const result = await generateStructuredJson({
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      schemaName: "digest_theme_synthesis",
      schema: digestThemeJsonSchema,
      validator: digestThemeSchema,
      systemPrompt: "system",
      userPrompt: "user",
      timeoutMs: 2_000
    });

    expect(result.data.themes_ko).toEqual(["OpenAI와 agent tooling이 실행 가능한 workflow에 더 가까워지고 있습니다."]);
    expect(result.usage).toEqual({ total_tokens: 123 });
  });
});

describe("digest enrichment helpers", () => {
  it("applies saved enrichment onto a digest entry", () => {
    const entry: DigestEntry = {
      number: 1,
      itemId: 42,
      sectionKey: "must_see",
      title: "Responses API update",
      summary: "old summary",
      whyImportant: "old why",
      contentSnippet: "snippet",
      primaryUrl: "https://openai.com/news/example",
      sourceLabel: "OpenAI / Product Releases",
      score: 99,
      scoreReasons: ["OpenAI 공식 소스"],
      sourceLinks: [{ label: "OpenAI", url: "https://openai.com/news/example" }],
      openaiCategory: "Product",
      keywords: ["OpenAI"],
      metadata: {}
    };

    const enrichment: ItemEnrichmentRecord = {
      id: 1,
      itemId: 42,
      llmRunId: 7,
      promptVersion: "item_enrichment_v1",
      sourceHash: "abc",
      summaryKo: "새로운 요약",
      whyImportantKo: "더 구체적인 중요성 설명",
      confidence: 0.91,
      uncertaintyNotes: [],
      themeTags: ["OpenAI", "agents"],
      officialnessNote: "official_openai",
      createdAt: "2026-04-02T00:00:00Z"
    };

    applyItemEnrichment(entry, enrichment);

    expect(entry.summary).toBe("새로운 요약");
    expect(entry.whyImportant).toBe("더 구체적인 중요성 설명");
    expect(entry.wasLlmEnriched).toBe(true);
    expect(entry.enrichmentConfidence).toBe(0.91);
    expect(entry.themeTags).toEqual(["OpenAI", "agents"]);
    expect(entry.officialnessNote).toBe("official_openai");
  });

  it("changes the theme cache key when digest explanations change", () => {
    const makeDigest = (summary: string): DigestBuildResult => ({
      mode: "pm",
      header: "[PM AI Wrap | 2026-04-02 ET]",
      window: {
        mode: "pm",
        startUtc: "2026-04-02T00:00:00Z",
        endUtc: "2026-04-02T12:00:00Z",
        dateLabel: "2026-04-02"
      },
      sections: [],
      themes: [],
      items: [
        {
          number: 1,
          itemId: 1,
          sectionKey: "top_developments",
          title: "Item",
          summary,
          whyImportant: "why",
          primaryUrl: "https://example.com",
          sourceLabel: "OpenAI",
          score: 90,
          scoreReasons: ["reason"],
          sourceLinks: [{ label: "OpenAI", url: "https://example.com" }],
          keywords: ["OpenAI"],
          metadata: {}
        }
      ],
      bodyText: "",
      stats: {}
    });

    expect(buildDigestThemeCacheKey(makeDigest("a"))).not.toBe(buildDigestThemeCacheKey(makeDigest("b")));
  });
});
