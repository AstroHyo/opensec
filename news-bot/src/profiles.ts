import type { NormalizedItemRecord, ProfileKey, SourceId } from "./types.js";

export const DEFAULT_PROFILE_KEY: ProfileKey = "tech";
export const PROFILE_KEYS: ProfileKey[] = ["tech", "finance"];

export interface NewsProfileConfig {
  key: ProfileKey;
  label: string;
  briefTitles: {
    am: string;
    pm: string;
    manual: string;
  };
  sourceIds: SourceId[];
}

export const PROFILE_CONFIGS: Record<ProfileKey, NewsProfileConfig> = {
  tech: {
    key: "tech",
    label: "Tech",
    briefTitles: {
      am: "AM AI Brief",
      pm: "PM AI Wrap",
      manual: "Manual AI Brief"
    },
    sourceIds: [
      "openai_news",
      "github_trending",
      "geeknews",
      "techmeme",
      "hacker_news"
    ]
  },
  finance: {
    key: "finance",
    label: "Finance",
    briefTitles: {
      am: "AM Macro Brief",
      pm: "PM Market Wrap",
      manual: "Manual Finance Brief"
    },
    sourceIds: [
      "fed_press",
      "sec_press",
      "treasury_press",
      "bls_cpi",
      "bls_jobs",
      "bls_ppi",
      "bls_eci",
      "major_company_filings"
    ]
  }
};

export function resolveProfileKey(raw?: string | null): ProfileKey {
  if (raw === "finance") {
    return "finance";
  }
  return DEFAULT_PROFILE_KEY;
}

export function getProfileConfig(profileKey: ProfileKey): NewsProfileConfig {
  return PROFILE_CONFIGS[profileKey];
}

export function matchesProfile(item: NormalizedItemRecord, profileKey: ProfileKey): boolean {
  const allowedSources = new Set(PROFILE_CONFIGS[profileKey].sourceIds);
  if (allowedSources.has(item.primarySourceId)) {
    return true;
  }

  return item.sources.some((source) => allowedSources.has(source.sourceId));
}
