import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { NewsDatabase } from "../src/db.js";
import { buildDigest } from "../src/digest/buildDigest.js";
import type { AppConfig } from "../src/config.js";
import type { SourceItemInput } from "../src/types.js";

const NOW = DateTime.fromISO("2026-04-15T19:30:00-04:00");
const FETCHED_AT = NOW.toUTC().toISO() ?? new Date().toISOString();

describe("finance brief selection", () => {
  it("keeps market-moving items and suppresses promotional or low-impact official items", () => {
    const db = new NewsDatabase(":memory:");
    const config = makeConfig();

    try {
      for (const item of financeInputs()) {
        db.upsertNormalizedItem(item);
      }

      const digest = buildDigest({ db, config, profileKey: "finance", mode: "pm", now: NOW });
      const titles = digest.items.map((item) => item.title);

      expect(titles).toContain("Minutes of the Board’s discount rate meetings on February 9 and March 18, 2026");
      expect(titles).toContain("NVIDIA 10-Q filing points to continued AI infrastructure capex");
      expect(titles).not.toContain("Over 53 Million Filers Claimed At Least One of President Trump’s Signature New Tax Cuts");
      expect(titles).not.toContain("Treasury Sanctions Cartel-Linked Casinos and Key Associates on U.S.-Mexico Border");
      expect(digest.items[0]?.title).toBe("Minutes of the Board’s discount rate meetings on February 9 and March 18, 2026");
      expect(digest.items[0]?.whatChanged).toContain("공개");
      expect(digest.items[1]?.whatChanged).toContain("NVIDIA");
      expect(digest.items[1]?.whatChanged).toContain("문구 변화");
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

function financeInputs(): SourceItemInput[] {
  return [
    {
      sourceId: "fed_press",
      sourceType: "macro_official",
      sourceLayer: "primary",
      sourceLabel: "Federal Reserve / Press Release",
      sourceAuthority: 95,
      externalId: "fed:2026-04-15-minutes",
      title: "Minutes of the Board’s discount rate meetings on February 9 and March 18, 2026",
      description: "The Federal Reserve released discount rate meeting minutes that feed directly into funding and rate-path interpretation.",
      contentText: "The Federal Reserve released discount rate meeting minutes that feed directly into funding and rate-path interpretation.",
      sourceUrl: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260414a.htm",
      canonicalUrl: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260414a.htm",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news",
      keywords: ["rates", "Fed", "funding"],
      metadata: {
        financeBucket: "rates_policy",
        marketImpactLevel: "high",
        transmissionChannels: ["rates", "funding", "liquidity"],
        affectedAssets: ["UST", "USD", "rate-sensitive equities"]
      }
    },
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
        financeBucket: "company_capital_ai",
        marketImpactLevel: "high",
        companyName: "NVIDIA",
        filingForm: "10-Q",
        transmissionChannels: ["capex", "guidance"],
        affectedAssets: ["semiconductors", "hyperscalers", "data center supply chain"]
      }
    },
    {
      sourceId: "treasury_press",
      sourceType: "regulatory_official",
      sourceLayer: "primary",
      sourceLabel: "Treasury / Press Release",
      sourceAuthority: 83,
      externalId: "treasury:tax-cut-pr",
      title: "Over 53 Million Filers Claimed At Least One of President Trump’s Signature New Tax Cuts",
      description: "Treasury promotional release around tax cuts and filing counts.",
      contentText: "Treasury promotional release around tax cuts and filing counts.",
      sourceUrl: "https://home.treasury.gov/news/press-releases/sb0441",
      canonicalUrl: "https://home.treasury.gov/news/press-releases/sb0441",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news",
      keywords: ["tax", "Treasury"],
      metadata: {
        financeBucket: "political_or_promotional",
        marketImpactLevel: "low",
        financeExcludeFromBrief: true
      }
    },
    {
      sourceId: "treasury_press",
      sourceType: "regulatory_official",
      sourceLayer: "primary",
      sourceLabel: "Treasury / Press Release",
      sourceAuthority: 84,
      externalId: "treasury:cartel-casinos",
      title: "Treasury Sanctions Cartel-Linked Casinos and Key Associates on U.S.-Mexico Border",
      description: "Treasury sanctions announcement with weak direct market transmission.",
      contentText: "Treasury sanctions announcement with weak direct market transmission.",
      sourceUrl: "https://home.treasury.gov/news/press-releases/sb0440",
      canonicalUrl: "https://home.treasury.gov/news/press-releases/sb0440",
      publishedAt: FETCHED_AT,
      fetchedAt: FETCHED_AT,
      itemKind: "news",
      keywords: ["sanctions", "Treasury"],
      metadata: {
        financeBucket: "enforcement_low_impact",
        marketImpactLevel: "low",
        financeExcludeFromBrief: true
      }
    }
  ];
}
