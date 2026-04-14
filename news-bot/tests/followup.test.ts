import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runFollowupCommand } from "../src/commands/followup.js";
import { runDigestFlow } from "../src/commands/runDigest.js";

const FIXTURE_NOW = "2026-03-27T10:00:00-04:00";

describe("follow-up natural language routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.NEWS_BOT_LLM_ENABLED;
  });

  it("maps natural language detail requests onto deterministic expand", async () => {
    const dbPath = await seedDigest();

    const result = await runFollowupCommand({
      command: "2번 자세히 설명해줘",
      nowIso: FIXTURE_NOW,
      dbPathOverride: dbPath
    });

    expect(result).toContain("[Expand 2]");
  });

  it("answers ask-mode questions from stored digest evidence without an LLM", async () => {
    const dbPath = await seedDigest();

    const result = await runFollowupCommand({
      command: "오늘 OpenAI 뉴스만 우리 관점으로 다시 요약해줘",
      nowIso: FIXTURE_NOW,
      dbPathOverride: dbPath
    });

    expect(result).toContain("[Ask]");
    expect(result).toContain("근거 항목:");
    expect(result).toContain("출처:");
  });

  it("uses the LLM for explicit ask mode when configured", async () => {
    const dbPath = await seedDigest();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.XAI_API_KEY = "test-key";
    process.env.NEWS_BOT_LLM_ENABLED = "true";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer_ko: "1번과 2번은 모두 OpenAI 중심 신호지만, 1번은 제품 변화이고 2번은 회사 방향성에 더 가깝습니다.",
                    bullets_ko: ["1번은 기능 변화에 가깝습니다.", "2번은 전략 방향성을 보여줍니다."],
                    used_item_numbers: [1, 2],
                    uncertainty_notes: []
                  })
                }
              }
            ],
            usage: { total_tokens: 77 }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const result = await runFollowupCommand({
      command: "ask 1번이랑 2번 차이를 알려줘",
      nowIso: FIXTURE_NOW,
      dbPathOverride: dbPath
    });

    expect(result).toContain("[Ask]");
    expect(result).toContain("1번과 2번은 모두 OpenAI 중심 신호지만");
    expect(result).toContain("근거 항목: 1, 2");
  });

  it("uses live research mode and renders cited links", async () => {
    const dbPath = await seedDigest();
    process.env.OPENAI_API_KEY = "test-key";
    process.env.NEWS_BOT_LLM_ENABLED = "true";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes("/v1/responses")) {
          return new Response(
            JSON.stringify({
              output: [
                {
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        answer_ko: "최신 공식 발표를 보면 2번 항목은 단기 제품 업데이트보다 회사 방향성과 파트너 전략 쪽 의미가 더 큽니다.",
                        bullets_ko: ["공식 발표가 추가 맥락을 제공합니다."],
                        implications_ko: ["우리 쪽에선 제품 변화보다 파트너십 신호로 읽는 게 맞습니다."],
                        used_item_numbers: [2],
                        uncertainty_notes: [],
                        sources: [
                          {
                            title: "Accelerating the next phase of AI",
                            url: "https://openai.com/index/accelerating-the-next-phase-ai",
                            publisher: "OpenAI",
                            why_used: "공식 방향성 설명",
                            source_type: "official"
                          }
                        ]
                      }),
                      annotations: [
                        {
                          url: "https://openai.com/index/accelerating-the-next-phase-ai",
                          title: "Accelerating the next phase of AI"
                        }
                      ]
                    }
                  ]
                }
              ],
              usage: { total_tokens: 140 }
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" }
            }
          );
        }

        throw new Error(`Unexpected URL: ${String(url)}`);
      })
    );

    const result = await runFollowupCommand({
      command: "research 2번 뉴스 관련 최신 공식 반응까지 찾아줘",
      nowIso: FIXTURE_NOW,
      dbPathOverride: dbPath
    });

    expect(result).toContain("[Research]");
    expect(result).toContain("추가 조사 링크:");
    expect(result).toContain("https://openai.com/index/accelerating-the-next-phase-ai");
  });

  it("falls back to stored evidence when research mode cannot use live LLM search", async () => {
    const dbPath = await seedDigest();

    const result = await runFollowupCommand({
      command: "research 오늘 OpenAI 뉴스가 왜 중요한지 더 조사해줘",
      nowIso: FIXTURE_NOW,
      dbPathOverride: dbPath
    });

    expect(result).toContain("[Research]");
    expect(result).toContain("저장된 digest 근거로 먼저 답했습니다");
    expect(result).toContain("[Ask]");
  });
});

async function seedDigest(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opensec-followup-"));
  const dbPath = path.join(dir, "news.sqlite");
  delete process.env.OPENAI_API_KEY;
  delete process.env.NEWS_BOT_LLM_ENABLED;

  const { db } = await runDigestFlow({
    mode: "am",
    nowIso: FIXTURE_NOW,
    dbPathOverride: dbPath,
    fixturePath: "./fixtures/sample-items.json",
    skipFetch: true,
    resetDb: true
  });
  db.close();

  return dbPath;
}
