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

  it("renders repo use cases for repo radar items", () => {
    const digest: DigestBuildResult = {
      profileKey: "tech",
      mode: "pm",
      header: "[PM AI Wrap | 2026-04-15 ET]",
      window: {
        mode: "pm",
        startUtc: "2026-04-15T00:00:00Z",
        endUtc: "2026-04-15T23:59:59Z",
        dateLabel: "2026-04-15"
      },
      sections: [
        {
          key: "repo_radar",
          title: "Repo Radar",
          items: [
            {
              profileKey: "tech",
              number: 3,
              itemId: 33,
              sectionKey: "repo_radar",
              sourceType: "github_trending",
              itemKind: "repo",
              title: "mvschwarz/openrig",
              summary: "요약",
              whyImportant: "중요성",
              whatChanged: "Claude Code와 Codex를 하나의 harness로 묶는 repo가 빠르게 주목받고 있습니다.",
              engineerRelevance: "멀티 agent workflow를 작은 실행 단계로 나눠 붙일 수 있는지 바로 검증해볼 수 있습니다.",
              aiEcosystem: "coding agent 경쟁축이 모델보다 orchestration 계층으로 이동하고 있습니다.",
              repoUseCase: "OpenSec에서는 이 repo를 별도 실험 흐름에 붙여 agent 간 역할 분리와 실행 경계를 더 세밀하게 나눠볼 수 있습니다.",
              trendSignal: "agent runtime과 orchestration 계층이 빠르게 라이브러리화되고 있습니다.",
              primaryUrl: "https://github.com/mvschwarz/openrig",
              sourceLabel: "GitHub Trending",
              score: 87,
              scoreReasons: ["Repo Radar"],
              sourceLinks: [{ label: "GitHub Trending", url: "https://github.com/mvschwarz/openrig" }],
              repoLanguage: "TypeScript",
              repoStarsToday: 1200,
              keywords: ["agents", "Codex"],
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
    expect(rendered).toContain("활용 포인트:");
    expect(rendered).toContain("OpenSec에서는 이 repo를 별도 실험 흐름에 붙여");
    expect(rendered).toContain("[3] mvschwarz/openrig | TypeScript | +1200 today");
  });

  it("renders finance digest items with market labels and bottom-only links", () => {
    const digest: DigestBuildResult = {
      profileKey: "finance",
      mode: "pm",
      header: "[PM Market Wrap | 2026-04-15 ET]",
      window: {
        mode: "pm",
        startUtc: "2026-04-15T13:00:00Z",
        endUtc: "2026-04-15T23:59:59Z",
        dateLabel: "2026-04-15"
      },
      sections: [
        {
          key: "top_developments",
          title: "핵심 변화",
          items: [
            {
              profileKey: "finance",
              number: 1,
              itemId: 51,
              sectionKey: "top_developments",
              sourceType: "company_filing",
              itemKind: "company",
              title: "NVIDIA 10-Q points to continued AI infrastructure capex",
              summary: "요약",
              whyImportant: "중요성",
              whatChanged: "NVIDIA 10-Q에서 AI infra capex와 forward demand 관련 문구가 다시 강조됐습니다.",
              marketTransmission: "capex 지속 신호가 확인되면 single-stock를 넘어서 semiconductor와 data center 공급망 기대를 다시 가격에 반영하게 됩니다.",
              affectedAssets: "영향 자산은 NVDA, semiconductor peers, hyperscaler capex chain입니다.",
              whyNow: "실적 시즌 전에 capex 지속성 문구가 먼저 확인되면 다음 guidance 해석의 기준점이 바뀝니다.",
              companyAngle: "risk factor와 demand tone 변화가 valuation narrative를 직접 흔들 수 있습니다.",
              aiCapitalAngle: "AI capex가 아직 둔화보다 지속 쪽에 가까운지 읽는 선행 단서입니다.",
              primaryUrl: "https://example.com/nvda-10q",
              sourceLabel: "SEC Filings / NVIDIA",
              score: 91,
              scoreReasons: ["AI capex read-through"],
              sourceLinks: [{ label: "SEC Filings / NVIDIA", url: "https://example.com/nvda-10q" }],
              keywords: ["AI", "capex", "NVIDIA"],
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
    expect(rendered).toContain("시장 연결:");
    expect(rendered).toContain("영향 자산:");
    expect(rendered).toContain("기업 / 자금 각도:");
    expect(rendered).toContain("AI 자금 각도:");
    expect(rendered).toContain("왜 지금:");
    expect(rendered).toContain("링크 모음");
    expect(rendered).toContain("[1] NVIDIA 10-Q points to continued AI infrastructure capex\nhttps://example.com/nvda-10q");
    expect(rendered).not.toContain("왜 중요한지:");
    expect(rendered).not.toContain("한줄 요약:");
    expect(rendered).not.toContain("링크:");
  });

  it("wraps bottom links safely for discord when configured", () => {
    const digest: DigestBuildResult = {
      profileKey: "tech",
      mode: "am",
      header: "[AM AI Brief | 2026-04-15 ET]",
      window: {
        mode: "am",
        startUtc: "2026-04-15T10:00:00Z",
        endUtc: "2026-04-15T14:00:00Z",
        dateLabel: "2026-04-15"
      },
      sections: [
        {
          key: "top_signals",
          title: "Top Signals",
          items: [
            {
              profileKey: "tech",
              number: 1,
              itemId: 99,
              sectionKey: "top_signals",
              sourceType: "openai_official",
              itemKind: "product",
              title: "Trusted access",
              summary: "요약",
              whyImportant: "중요성",
              whatChanged: "OpenAI가 보안 프로그램 범위를 넓혔습니다.",
              engineerRelevance: "접근 통제와 로깅 기준을 다시 봐야 합니다.",
              aiEcosystem: "보안 배포 경계가 더 촘촘해집니다.",
              trendSignal: "보안 capability 공개가 곧 운영 정책 변경으로 이어지고 있습니다.",
              primaryUrl: "https://openai.com/index/scaling-trusted-access-for-cyber-defense",
              sourceLabel: "OpenAI / Security",
              score: 95,
              scoreReasons: ["OpenAI 공식 소스"],
              sourceLinks: [{ label: "OpenAI / Security", url: "https://openai.com/index/scaling-trusted-access-for-cyber-defense" }],
              keywords: ["OpenAI", "security"],
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

    const rendered = renderTelegramDigest(digest, { linkStyle: "discord_safe" });
    expect(rendered).toContain("<https://openai.com/index/scaling-trusted-access-for-cyber-defense>");
    expect(rendered).not.toContain("링크:");
  });
});
