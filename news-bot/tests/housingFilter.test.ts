import { describe, expect, it } from "vitest";
import { evaluateHousingRules } from "../src/housing/filter.js";

describe("housing rule filter", () => {
  it("rejects female-only listings immediately", () => {
    const result = evaluateHousingRules({
      title: "Mission Bay studio 转租",
      bodyText: "仅限女生，5月到8月，studio 整租。",
      locationText: "Mission Bay, San Francisco"
    });

    expect(result.decision).toBe("reject");
    expect(result.decisionReasons.join(" ")).toContain("여성");
  });

  it("rejects roommate and shared-space listings", () => {
    const result = evaluateHousingRules({
      title: "SF 1b1b room available",
      bodyText: "1b1b master bedroom, shared kitchen, looking for roommate",
      locationText: "SOMA, San Francisco"
    });

    expect(result.decision).toBe("reject");
    expect(result.roommateOnly).toBe(true);
    expect(result.sharedSpace).toBe(true);
  });

  it("matches a studio whole-unit summer listing in San Francisco", () => {
    const result = evaluateHousingRules({
      title: "Mission Bay studio summer sublease",
      bodyText: "Studio entire apartment available May through August. No roommates. Near T line.",
      locationText: "Mission Bay, San Francisco"
    });

    expect(result.decision).toBe("match");
    expect(result.unitType).toBe("studio");
    expect(result.wholeUnit).toBe(true);
    expect(result.commuteFriendly).toBe(true);
  });

  it("keeps ambiguous listings as maybe", () => {
    const result = evaluateHousingRules({
      title: "SF summer rental",
      bodyText: "Available for summer in SF. DM for details.",
      locationText: "San Francisco"
    });

    expect(result.decision).toBe("maybe");
    expect(result.decisionReasons.length).toBeGreaterThan(0);
  });
});
