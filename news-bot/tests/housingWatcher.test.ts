import { describe, expect, it } from "vitest";
import { resolveEvaluation } from "../src/commands/watchXiaohongshuRent.js";
import { NewsDatabase } from "../src/db.js";
import type { HousingAdjudicationResult, HousingRuleEvaluation } from "../src/housing/types.js";

describe("housing adjudication resolution", () => {
  it("does not promote to match when whole-unit evidence is still ambiguous", () => {
    const rule: HousingRuleEvaluation = {
      decision: "maybe",
      decisionReasons: ["전체 유닛인지 확정하기 어렵습니다."],
      city: "San Francisco",
      neighborhood: "mission bay",
      locationSummary: "mission bay",
      unitType: "1b1b",
      wholeUnit: null,
      femaleOnly: null,
      sharedSpace: null,
      roommateOnly: null,
      commuteFriendly: true,
      availabilitySummary: "5월-8월 가능",
      availabilityStart: "2026-05-01",
      availabilityEnd: "2026-08-31"
    };

    const llm: HousingAdjudicationResult = {
      noteId: "abc123456",
      decision: "match",
      confidence: 0.88,
      city: "San Francisco",
      neighborhood: "mission bay",
      locationSummary: "Mission Bay",
      availabilitySummary: "May to August",
      availabilityStart: "2026-05-01",
      availabilityEnd: "2026-08-31",
      unitType: "1b1b",
      wholeUnit: null,
      femaleOnly: false,
      sharedSpace: false,
      roommateOnly: false,
      commuteFriendly: true,
      decisionReasons: ["Looks like a 1b1b summer rental."],
      uncertaintyNotes: []
    };

    const resolved = resolveEvaluation(rule, llm);
    expect(resolved.decision).toBe("maybe");
  });
});

describe("housing watcher persistence", () => {
  it("merges search queries and keeps decision-specific notification keys separate", () => {
    const db = new NewsDatabase(":memory:");

    try {
      const candidate = db.upsertHousingWatchCandidate({
        noteId: "abc123456",
        noteUrl: "https://www.xiaohongshu.com/explore/abc123456",
        title: "Mission Bay studio",
        authorName: "tester",
        city: "San Francisco",
        neighborhood: "mission bay",
        locationSummary: "mission bay",
        locationText: "Mission Bay, San Francisco",
        postedAt: null,
        seenAt: "2026-04-10T12:00:00Z",
        lastEvaluatedAt: "2026-04-10T12:00:00Z",
        searchQueries: ["旧金山 studio"],
        bodyText: "Studio available May-August.",
        pageText: "Studio available May-August in Mission Bay.",
        ocrText: null,
        imageUrls: ["https://example.com/image.jpg"],
        screenshotCaptured: true,
        hardFilterDecision: "match",
        hardFilterReasons: ["본문 기준으로 studio 전체 유닛으로 보입니다."],
        llmPromptVersion: "xhs_rent_adjudication_v1",
        llmModelName: "gpt-4.1-mini",
        llmInputHash: "hash-a",
        llmOutput: { decision: "maybe" },
        decision: "maybe",
        decisionReasons: ["위치는 맞지만 전체 유닛 여부가 애매합니다."],
        confidence: 0.55,
        unitType: "studio",
        wholeUnit: null,
        femaleOnly: false,
        sharedSpace: false,
        roommateOnly: false,
        availabilitySummary: "5월-8월 가능",
        availabilityStart: "2026-05-01",
        availabilityEnd: "2026-08-31",
        commuteFriendly: true,
        rawPayload: { source: "search" }
      });

      const updated = db.upsertHousingWatchCandidate({
        noteId: "abc123456",
        noteUrl: "https://www.xiaohongshu.com/explore/abc123456",
        title: "Mission Bay studio summer sublease",
        authorName: "tester",
        city: "San Francisco",
        neighborhood: "mission bay",
        locationSummary: "mission bay",
        locationText: "Mission Bay, San Francisco",
        postedAt: null,
        seenAt: "2026-04-10T12:10:00Z",
        lastEvaluatedAt: "2026-04-10T12:10:00Z",
        searchQueries: ["San Francisco studio"],
        bodyText: "Studio available May-August. Entire unit.",
        pageText: "Studio available May-August. Entire unit in Mission Bay.",
        ocrText: "Entire unit",
        imageUrls: ["https://example.com/image2.jpg"],
        screenshotCaptured: true,
        hardFilterDecision: "match",
        hardFilterReasons: ["본문 기준으로 studio 전체 유닛으로 보입니다."],
        llmPromptVersion: "xhs_rent_adjudication_v1",
        llmModelName: "gpt-4.1-mini",
        llmInputHash: "hash-b",
        llmOutput: { decision: "match" },
        decision: "match",
        decisionReasons: ["전체 유닛 studio로 보입니다."],
        confidence: 0.91,
        unitType: "studio",
        wholeUnit: true,
        femaleOnly: false,
        sharedSpace: false,
        roommateOnly: false,
        availabilitySummary: "5월-8월 가능",
        availabilityStart: "2026-05-01",
        availabilityEnd: "2026-08-31",
        commuteFriendly: true,
        rawPayload: { source: "detail" }
      });

      expect(updated.searchQueries.sort()).toEqual(["San Francisco studio", "旧金山 studio"].sort());
      expect(updated.decision).toBe("match");
      expect(updated.ocrText).toBe("Entire unit");

      const maybeNotification = db.createHousingNotification({
        candidateId: candidate.id,
        notificationType: "candidate",
        deliveryKey: "candidate:abc123456:maybe",
        destinationUserId: "owner",
        status: "sent",
        messageText: "maybe",
        createdAt: "2026-04-10T12:00:00Z"
      });
      const maybeNotificationAgain = db.createHousingNotification({
        candidateId: candidate.id,
        notificationType: "candidate",
        deliveryKey: "candidate:abc123456:maybe",
        destinationUserId: "owner",
        status: "sent",
        messageText: "maybe",
        createdAt: "2026-04-10T12:00:00Z"
      });
      const matchNotification = db.createHousingNotification({
        candidateId: candidate.id,
        notificationType: "candidate",
        deliveryKey: "candidate:abc123456:match",
        destinationUserId: "owner",
        status: "sent",
        messageText: "match",
        createdAt: "2026-04-10T12:10:00Z"
      });

      expect(maybeNotificationAgain.id).toBe(maybeNotification.id);
      expect(matchNotification.id).not.toBe(maybeNotification.id);
    } finally {
      db.close();
    }
  });
});
