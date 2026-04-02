import { describe, expect, it } from "vitest";
import { escapeTelegramMarkdownV2 } from "../src/digest/renderTelegram.js";

describe("telegram escaping", () => {
  it("escapes markdown v2 metacharacters safely", () => {
    expect(escapeTelegramMarkdownV2("[repo]_name!")).toBe("\\[repo\\]\\_name\\!");
  });
});
