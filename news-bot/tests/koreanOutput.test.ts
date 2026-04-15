import { describe, expect, it } from "vitest";
import { looksMostlyEnglishNarrative, preferKoreanNarrative } from "../src/llm/koreanOutput.js";
import { collapseWhitespace } from "../src/util/text.js";

describe("korean output guard", () => {
  it("detects mostly English narrative sentences", () => {
    expect(looksMostlyEnglishNarrative("I've been running Claude Code and Codex together every day.")).toBe(true);
    expect(looksMostlyEnglishNarrative("Claude Code와 Codex를 함께 묶는 실험이 늘고 있습니다.")).toBe(false);
  });

  it("falls back to Korean text when the candidate is mostly English", () => {
    expect(
      preferKoreanNarrative(
        "Engineers should evaluate workflow integration friction before adopting it.",
        "도입 전에 workflow integration 경계와 운영 비용을 먼저 확인해야 합니다.",
        180
      )
    ).toBe("도입 전에 workflow integration 경계와 운영 비용을 먼저 확인해야 합니다.");
  });
});

describe("text normalization", () => {
  it("decodes common HTML entities while collapsing whitespace", () => {
    expect(collapseWhitespace("I&#x27;ve&nbsp;been&nbsp;testing")).toBe("I've been testing");
  });
});
