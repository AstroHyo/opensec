import { describe, expect, it } from "vitest";
import { escapeTelegramMarkdownV2, renderTelegramDigest } from "../src/digest/renderTelegram.js";
import type { DigestBuildResult } from "../src/types.js";

describe("telegram escaping", () => {
  it("escapes markdown v2 metacharacters safely", () => {
    expect(escapeTelegramMarkdownV2("[repo]_name!")).toBe("\\[repo\\]\\_name\\!");
  });

  it("renders tech digest items with insight labels instead of generic importance", () => {
    const digest: DigestBuildResult = {
      profileKey: "tech",
      mode: "am",
      header: "[AM AI Brief | 2026-04-14 ET]",
      window: {
        mode: "am",
        startUtc: "2026-04-14T10:00:00Z",
        endUtc: "2026-04-14T14:00:00Z",
        dateLabel: "2026-04-14"
      },
      sections: [
        {
          key: "top_signals",
          title: "Top Signals",
          items: [
            {
              profileKey: "tech",
              number: 1,
              itemId: 11,
              sectionKey: "top_signals",
              sourceType: "openai_official",
              itemKind: "product",
              title: "Responses API update",
              summary: "요약",
              whyImportant: "중요성",
              whatChanged: "Responses API에 새로운 computer use 흐름이 추가되었습니다.",
              engineerRelevance: "API integration과 eval harness를 같이 다시 봐야 합니다.",
              aiEcosystem: "agent runtime 계층이 더 두꺼워지는 흐름입니다.",
              openAiAngle: "OpenAI가 실행 계층을 직접 제품화하는 신호입니다.",
              trendSignal: "모델보다 실행 스택 경쟁이 강해지고 있습니다.",
              causeEffect: "도구 사용이 제품 기능으로 수렴하면 wrapper ecosystem이 재편됩니다.",
              watchpoints: ["SDK changelog 확인"],
              evidenceSpans: ["computer use preview"],
              primaryUrl: "https://openai.com/example",
              sourceLabel: "OpenAI / Product Releases",
              score: 95,
              deterministicScore: 95,
              rerankDelta: 0,
              finalScore: 95,
              scoreReasons: ["OpenAI 공식 소스"],
              sourceLinks: [{ label: "OpenAI", url: "https://openai.com/example" }],
              keywords: ["OpenAI", "agents"],
              metadata: {}
            }
          ]
        }
      ],
      themes: [],
      items: [],
      bodyText: "",
      stats: {}
    };

    const rendered = renderTelegramDigest(digest);
    expect(rendered).toContain("무슨 일:");
    expect(rendered).toContain("엔지니어 관점:");
    expect(rendered).toContain("AI 맥락:");
    expect(rendered).toContain("OpenAI 각도:");
    expect(rendered).toContain("변화 신호:");
    expect(rendered).toContain("링크 모음");
    expect(rendered).toContain("[1] Responses API update\nhttps://openai.com/example");
    expect(rendered).not.toContain("왜 중요한지:");
    expect(rendered).not.toContain("링크:");
  });

  it("prefers cause/effect over generic trend text and suppresses redundant OpenAI angle", () => {
    const digest: DigestBuildResult = {
      profileKey: "tech",
      mode: "am",
      header: "[AM AI Brief | 2026-04-14 ET]",
      window: {
        mode: "am",
        startUtc: "2026-04-14T10:00:00Z",
        endUtc: "2026-04-14T14:00:00Z",
        dateLabel: "2026-04-14"
      },
      sections: [
        {
          key: "top_signals",
          title: "Top Signals",
          items: [
            {
              profileKey: "tech",
              number: 1,
              itemId: 12,
              sectionKey: "top_signals",
              sourceType: "openai_official",
              itemKind: "product",
              title: "GPT mini update",
              summary: "요약",
              whyImportant: "중요성",
              whatChanged: "GPT-5.4 mini가 고부하 API 워크로드에 맞춰 출시되었습니다.",
              engineerRelevance: "가격 정책과 latency budget을 다시 계산해야 합니다.",
              aiEcosystem: "서브에이전트와 router가 소형 모델 활용 비중을 높이게 됩니다.",
              openAiAngle: "GPT-5.4 mini가 고부하 API 워크로드에 맞춰 출시되었습니다.",
              trendSignal: "모델 라인업이 운영 가능한 스택으로 자리잡고 있습니다.",
              causeEffect: "저지연 서브에이전트와 batch workflow에서 소형 모델 채택이 늘어날 것입니다.",
              primaryUrl: "https://openai.com/example-mini",
              sourceLabel: "OpenAI / Product Releases",
              score: 93,
              scoreReasons: ["OpenAI 공식 소스"],
              sourceLinks: [{ label: "OpenAI", url: "https://openai.com/example-mini" }],
              keywords: ["OpenAI", "GPT"],
              metadata: {}
            }
          ]
        }
      ],
      themes: [],
      items: [],
      bodyText: "",
      stats: {}
    };

    const rendered = renderTelegramDigest(digest);
    expect(rendered).toContain("변화 신호: 저지연 서브에이전트와 batch workflow에서 소형 모델 채택이 늘어날 것입니다.");
    expect(rendered).not.toContain("OpenAI 각도:");
    expect(rendered).toContain("링크 모음");
    expect(rendered).toContain("[1] GPT mini update\nhttps://openai.com/example-mini");
  });
});
