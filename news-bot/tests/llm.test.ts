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
      repoUseCaseKo: null,
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

  it("clears fallback OpenAI angle when the enrichment explicitly returns null", () => {
    const entry: DigestEntry = {
      profileKey: "tech",
      number: 1,
      itemId: 7,
      sectionKey: "top_signals",
      sourceType: "openai_official",
      itemKind: "engineering",
      title: "Agent runtime update",
      summary: "old summary",
      whyImportant: "old why",
      whatChanged: "OpenAI가 hosted runtime을 추가했습니다.",
      engineerRelevance: "eval harness를 다시 봐야 합니다.",
      aiEcosystem: "agent tooling 레이어가 조정됩니다.",
      openAiAngle: "OpenAI가 어디에 자원을 쓰는지 보여주는 신호입니다.",
      trendSignal: "실행 스택이 두꺼워집니다.",
      causeEffect: "wrapper ecosystem이 재편됩니다.",
      contentSnippet: "snippet",
      primaryUrl: "https://openai.com/news/runtime",
      sourceLabel: "OpenAI / Engineering",
      score: 98,
      scoreReasons: ["OpenAI 공식 소스"],
      sourceLinks: [{ label: "OpenAI", url: "https://openai.com/news/runtime" }],
      keywords: ["OpenAI", "agents"],
      metadata: {}
    };

    const enrichment: ItemEnrichmentRecord = {
      id: 2,
      profileKey: "tech",
      itemId: 7,
      llmRunId: 8,
      promptVersion: "item_enrichment_v2",
      sourceHash: "def",
      summaryKo: "새 요약",
      whyImportantKo: "새 중요성",
      whatChangedKo: "Responses API 안에서 shell 실행이 가능해졌습니다.",
      engineerRelevanceKo: "permission과 sandbox 경계를 다시 설계해야 합니다.",
      aiEcosystemKo: "framework가 wrapper보다 policy/eval 경쟁으로 이동합니다.",
      openAiAngleKo: null,
      repoUseCaseKo: null,
      trendSignalKo: "agent runtime이 API boundary 안으로 들어오는 흐름입니다.",
      causeEffectKo: "기존 wrapper 생태계가 재편될 수 있습니다.",
      watchpoints: [],
      evidenceSpans: [],
      noveltyScore: 0.7,
      insightScore: 0.84,
      confidence: 0.88,
      uncertaintyNotes: [],
      themeTags: ["OpenAI"],
      officialnessNote: "official_openai",
      createdAt: "2026-04-14T00:00:00Z"
    };

    applyItemEnrichment(entry, enrichment);

    expect(entry.openAiAngle).toBeNull();
  });

  it("falls back when a repo enrichment returns English narrative sentences", () => {
    const entry: DigestEntry = {
      profileKey: "tech",
      number: 3,
      itemId: 99,
      sectionKey: "repo_radar",
      sourceType: "github_trending",
      itemKind: "repo",
      title: "mvschwarz/openrig",
      summary: "기본 요약",
      whyImportant: "기본 중요성",
      whatChanged: "여러 coding agent를 하나의 harness로 묶는 실험용 repo가 빠르게 주목받고 있습니다.",
      engineerRelevance: "로컬 작업 흐름과 agent orchestration 경계를 함께 테스트해볼 수 있습니다.",
      aiEcosystem: "coding agent 경쟁이 모델보다 운영 계층으로 이동하는 흐름과 맞닿아 있습니다.",
      trendSignal: "agent orchestration 계층이 빠르게 라이브러리화되고 있습니다.",
      causeEffect: "이런 repo가 늘수록 도입팀은 모델 성능보다 실행 구조를 더 많이 비교하게 됩니다.",
      primaryUrl: "https://github.com/mvschwarz/openrig",
      sourceLabel: "GitHub Trending",
      score: 88,
      scoreReasons: ["Repo Radar"],
      sourceLinks: [{ label: "GitHub Trending", url: "https://github.com/mvschwarz/openrig" }],
      repoLanguage: "TypeScript",
      repoStarsToday: 1200,
      keywords: ["agents", "Codex", "Claude Code"],
      metadata: {}
    };

    const enrichment: ItemEnrichmentRecord = {
      id: 3,
      profileKey: "tech",
      itemId: 99,
      llmRunId: 9,
      promptVersion: "item_enrichment_v3",
      sourceHash: "ghi",
      summaryKo: "영문 fallback",
      whyImportantKo: "영문 fallback",
      whatChangedKo: "I've been running Claude Code and Codex together every day.",
      engineerRelevanceKo: "Engineers should evaluate workflow integration friction before adopting it.",
      aiEcosystemKo: "The ecosystem is moving toward execution-layer competition.",
      openAiAngleKo: null,
      repoUseCaseKo: "OpenSec can plug this into its workflow orchestration layer.",
      trendSignalKo: "This is a signal that orchestration is becoming the real product layer.",
      causeEffectKo: "This will cause more teams to compare runtime structure.",
      watchpoints: ["Check the README"],
      evidenceSpans: ["tmux harness"],
      noveltyScore: 0.75,
      insightScore: 0.8,
      confidence: 0.82,
      uncertaintyNotes: [],
      themeTags: ["agents"],
      officialnessNote: "repo_signal",
      createdAt: "2026-04-15T00:00:00Z"
    };

    applyItemEnrichment(entry, enrichment);

    expect(entry.whatChanged).toBe("여러 coding agent를 하나의 harness로 묶는 실험용 repo가 빠르게 주목받고 있습니다.");
    expect(entry.engineerRelevance).toBe("로컬 작업 흐름과 agent orchestration 경계를 함께 테스트해볼 수 있습니다.");
    expect(entry.repoUseCase).toContain("OpenSec");
    expect(entry.repoUseCase).toContain("workflow");
  });

  it("maps finance enrichment fields onto market-oriented digest fields", () => {
    const entry: DigestEntry = {
      profileKey: "finance",
      number: 2,
      itemId: 55,
      sectionKey: "top_developments",
      sourceType: "company_filing",
      itemKind: "company",
      title: "NVIDIA 10-Q filing points to continued AI infrastructure capex",
      summary: "기본 금융 요약",
      whyImportant: "기본 금융 중요성",
      whatChanged: "기본 변화",
      marketTransmission: "기본 시장 연결",
      affectedAssets: "기본 영향 자산",
      whyNow: "기본 왜 지금",
      companyAngle: "기본 기업 각도",
      aiCapitalAngle: "기본 AI 자금 각도",
      primaryUrl: "https://example.com/nvda",
      sourceLabel: "SEC Filings / NVIDIA",
      score: 90,
      scoreReasons: ["AI capex read-through"],
      sourceLinks: [{ label: "SEC Filings / NVIDIA", url: "https://example.com/nvda" }],
      keywords: ["AI", "capex", "NVIDIA"],
      metadata: {}
    };

    const enrichment: ItemEnrichmentRecord = {
      id: 4,
      profileKey: "finance",
      itemId: 55,
      llmRunId: 10,
      promptVersion: "item_enrichment_v4",
      sourceHash: "finance",
      summaryKo: "요약",
      whyImportantKo: "중요성",
      whatChangedKo: "NVIDIA 10-Q에서 data center 수요와 capex 지속성이 다시 강조됐습니다.",
      engineerRelevanceKo: "capex 지속 신호가 확인되면 semiconductor와 공급망 기대를 다시 가격에 반영하게 됩니다.",
      aiEcosystemKo: "영향 자산은 NVDA와 semiconductor peers, hyperscaler 투자 체인 쪽입니다.",
      openAiAngleKo: "AI infra capex가 아직 둔화보다 지속 쪽에 가까운지 읽는 선행 단서입니다.",
      repoUseCaseKo: null,
      trendSignalKo: "실적 시즌 전에 capex 지속성 문구가 먼저 확인되면 다음 guidance 해석의 기준점이 바뀝니다.",
      causeEffectKo: "다음 실적 발표에서 공급망과 hyperscaler 투자 계획이 함께 재평가될 가능성이 큽니다.",
      watchpoints: ["다음 earnings call에서 capex 가이던스 확인"],
      evidenceSpans: ["AI demand and capex intensity remained elevated"],
      noveltyScore: 0.78,
      insightScore: 0.86,
      confidence: 0.9,
      uncertaintyNotes: [],
      themeTags: ["AI-capex", "semis"],
      officialnessNote: "official_vendor",
      createdAt: "2026-04-15T00:00:00Z"
    };

    applyItemEnrichment(entry, enrichment);

    expect(entry.marketTransmission).toContain("semiconductor");
    expect(entry.affectedAssets).toContain("NVDA");
    expect(entry.whyNow).toContain("실적 시즌");
    expect(entry.aiCapitalAngle).toContain("AI infra capex");
    expect(entry.openAiAngle).toBeNull();
    expect(entry.repoUseCase).toBeNull();
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
