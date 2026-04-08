import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { NewsDatabase } from "../src/db.js";
import { buildDigest } from "../src/digest/buildDigest.js";
import type { AppConfig } from "../src/config.js";
import type { SourceItemInput } from "../src/types.js";

const NOW = DateTime.fromISO("2026-04-08T09:30:00-04:00");
const FETCHED_AT = NOW.toUTC().toISO() ?? new Date().toISOString();

describe("profile-scoped digest state", () => {
  it("builds separate tech and finance digests from shared evidence", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();

    try {
      for (const item of sharedStoryInputs()) {
        db.upsertNormalizedItem(item);
      }

      const techDigest = buildDigest({ db, config, profileKey: "tech", mode: "am", now: NOW });
      const financeDigest = buildDigest({ db, config, profileKey: "finance", mode: "am", now: NOW });

      expect(techDigest.items).toHaveLength(1);
      expect(financeDigest.items).toHaveLength(1);
      expect(techDigest.items[0].itemId).toBe(financeDigest.items[0].itemId);
      expect(techDigest.items[0].profileKey).toBe("tech");
      expect(financeDigest.items[0].profileKey).toBe("finance");
      expect(techDigest.items[0].summary).not.toBe(financeDigest.items[0].summary);
      expect(financeDigest.items[0].whyImportant).toContain("valuation");
    } finally {
      db.close();
    }
  });

  it("persists latest digest and follow-up context by profile only", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();

    try {
      for (const item of sharedStoryInputs()) {
        db.upsertNormalizedItem(item);
      }

      const techDigest = buildDigest({ db, config, profileKey: "tech", mode: "am", now: NOW });
      const financeDigest = buildDigest({ db, config, profileKey: "finance", mode: "am", now: NOW });

      const savedTech = db.saveDigest("tech", techDigest, FETCHED_AT);
      const savedFinance = db.saveDigest("finance", financeDigest, FETCHED_AT);

      expect(db.getLatestDigest("tech")?.id).toBe(savedTech.id);
      expect(db.getLatestDigest("finance")?.id).toBe(savedFinance.id);
      expect(db.getFollowupContext("tech", 1)?.profileKey).toBe("tech");
      expect(db.getFollowupContext("finance", 1)?.profileKey).toBe("finance");
      expect(db.getFollowupContext("finance", 1)?.summary).not.toBe(db.getFollowupContext("tech", 1)?.summary);
    } finally {
      db.close();
    }
  });

  it("keeps resend suppression isolated per profile", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();

    try {
      for (const item of sharedStoryInputs()) {
        db.upsertNormalizedItem(item);
      }

      const techDigest = buildDigest({ db, config, profileKey: "tech", mode: "am", now: NOW });
      db.saveDigest("tech", techDigest, FETCHED_AT);

      const techCandidates = db.listCandidateItems("tech", NOW.minus({ hours: 72 }).toUTC().toISO() ?? FETCHED_AT);
      const financeCandidates = db.listCandidateItems("finance", NOW.minus({ hours: 72 }).toUTC().toISO() ?? FETCHED_AT);

      expect(techCandidates[0]?.lastSentAt).toBeTruthy();
      expect(financeCandidates[0]?.lastSentAt).toBeNull();
    } finally {
      db.close();
    }
  });
});

function makeConfig(): AppConfig {
  const config = loadConfig(process.cwd());
  return {
    ...config,
    llm: {
      ...config.llm,
      enabled: false,
      themesEnabled: false,
      rerankEnabled: false
    }
  };
}

function sharedStoryInputs(): SourceItemInput[] {
  return [
    {
      sourceId: "major_company_filings",
      sourceType: "company_filing",
      sourceLayer: "primary",
      sourceLabel: "SEC Filings / NVIDIA",
      sourceAuthority: 88,
      externalId: "NVDA:0001045810-26-000010",
      title: "NVIDIA 10-Q filing points to continued AI infrastructure capex",
      description: "NVIDIA files a 10-Q highlighting AI demand, capex intensity, and forward-looking risk disclosures.",
      contentText: "NVIDIA files a 10-Q highlighting AI demand, capex intensity, and forward-looking risk disclosures.",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/nvda10q.htm",
      canonicalUrl: "https://investor.example.com/nvidia-ai-capex-note",
      originalUrl: "https://investor.example.com/nvidia-ai-capex-note",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "company",
      keywords: ["NVIDIA", "AI", "capex", "filing"],
      metadata: {
        financeBucket: "company",
        companyName: "NVIDIA",
        filingForm: "10-Q"
      }
    },
    {
      sourceId: "geeknews",
      sourceType: "geeknews",
      sourceLayer: "precision",
      sourceLabel: "GeekNews / News",
      sourceAuthority: 62,
      externalId: "28001",
      title: "NVIDIA 10-Q filing points to continued AI infrastructure capex",
      description: "GeekNews discussion about NVIDIA's AI capex, infra demand, and second-order impact on the AI tooling market.",
      contentText: "GeekNews discussion about NVIDIA's AI capex, infra demand, and second-order impact on the AI tooling market.",
      sourceUrl: "https://news.hada.io/topic?id=28001",
      canonicalUrl: "https://investor.example.com/nvidia-ai-capex-note",
      originalUrl: "https://investor.example.com/nvidia-ai-capex-note",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news",
      geeknewsKind: "news",
      keywords: ["AI", "infrastructure", "capex", "developer tooling"],
      metadata: {
        financeBucket: "company"
      }
    }
  ];
}
