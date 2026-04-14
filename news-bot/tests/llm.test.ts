import { afterEach, describe, expect, it, vi } from "vitest";
import { generateStructuredJson, generateStructuredJsonWithResponsesInput } from "../src/llm/openaiClient.js";
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

  it("parses a strict Responses API body with multimodal input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              themes_ko: ["OCR와 text bundle이 모두 정상적으로 파싱되었습니다."]
            }),
            usage: {
              total_tokens: 77
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const result = await generateStructuredJsonWithResponsesInput({
      apiKey: "test-key",
      model: "gpt-4.1-mini",
      schemaName: "digest_theme_synthesis",
      schema: digestThemeJsonSchema,
      validator: digestThemeSchema,
      systemPrompt: "system",
      inputItems: [
        { type: "text", text: "hello" },
        { type: "image", imageUrl: "data:image/jpeg;base64,AAAA" }
      ],
      timeoutMs: 2_000
    });

    expect(result.data.themes_ko).toEqual(["OCR와 text bundle이 모두 정상적으로 파싱되었습니다."]);
    expect(result.usage).toEqual({ total_tokens: 77 });
  });
});

describe("digest enrichment helpers", () => {
  it("applies saved enrichment onto a digest entry", () => {
    const entry: DigestEntry = {
      profileKey: "tech",
      number: 1,
      itemId: 42,
      sectionKey: "must_see",
      sourceType: "openai_official",
      itemKind: "product",
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
      profileKey: "tech",
      itemId: 42,
      llmRunId: 7,
      promptVersion: "item_enrichment_v2",
      sourceHash: "abc",
      summaryKo: "새로운 요약",
      whyImportantKo: "더 구체적인 중요성 설명",
      whatChangedKo: "Responses API에 실행 환경이 붙으면서 실제 작업 흐름이 더 길어졌습니다.",
      engineerRelevanceKo: "기존 integration 코드와 eval harness를 다시 봐야 합니다.",
      aiEcosystemKo: "agent runtime 계층이 더 제품화되는 흐름입니다.",
      openAiAngleKo: "OpenAI가 실행 계층을 직접 밀고 있습니다.",
      trendSignalKo: "모델보다 실행 스택 경쟁이 강해집니다.",
      causeEffectKo: "wrapper/tooling ecosystem이 재정렬될 가능성이 큽니다.",
      watchpoints: ["SDK changelog 확인"],
      evidenceSpans: ["computer use preview"],
      noveltyScore: 0.8,
      insightScore: 0.9,
      confidence: 0.91,
      uncertaintyNotes: [],
      themeTags: ["OpenAI", "agents"],
      officialnessNote: "official_openai",
      createdAt: "2026-04-02T00:00:00Z"
    };

    applyItemEnrichment(entry, enrichment);

    expect(entry.summary).toBe("Responses API에 실행 환경이 붙으면서 실제 작업 흐름이 더 길어졌습니다.");
    expect(entry.whyImportant).toContain("기존 integration 코드와 eval harness");
    expect(entry.whatChanged).toContain("실행 환경");
    expect(entry.engineerRelevance).toContain("integration 코드");
    expect(entry.aiEcosystem).toContain("runtime");
    expect(entry.openAiAngle).toContain("OpenAI");
    expect(entry.watchpoints).toEqual(["SDK changelog 확인"]);
    expect(entry.evidenceSpans).toEqual(["computer use preview"]);
    expect(entry.wasLlmEnriched).toBe(true);
    expect(entry.enrichmentConfidence).toBe(0.91);
    expect(entry.themeTags).toEqual(["OpenAI", "agents"]);
    expect(entry.officialnessNote).toBe("official_openai");
    expect(entry.finalScore).toBeGreaterThan(90);
  });

  it("changes the theme cache key when digest explanations change", () => {
    const makeDigest = (summary: string): DigestBuildResult => ({
      profileKey: "tech",
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
          profileKey: "tech",
          number: 1,
          itemId: 1,
          sectionKey: "top_developments",
          sourceType: "openai_official",
          itemKind: "product",
          title: "Item",
          summary,
          whyImportant: "why",
          whatChanged: summary,
          engineerRelevance: "eng",
          aiEcosystem: "eco",
          trendSignal: "trend",
          causeEffect: "cause",
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
