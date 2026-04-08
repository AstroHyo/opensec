import type { SourceId, SourceLayer, SourceType } from "../types.js";

export function inferSourceLayer(sourceId: SourceId, sourceType?: SourceType): SourceLayer {
  if (sourceId === "bluesky_watch" || sourceType === "social_signal") {
    return "early_warning";
  }

  if (
    sourceId === "openai_news" ||
    sourceId === "github_trending" ||
    sourceId === "fed_press" ||
    sourceId === "sec_press" ||
    sourceId === "treasury_press" ||
    sourceId === "bls_cpi" ||
    sourceId === "bls_jobs" ||
    sourceId === "bls_ppi" ||
    sourceId === "bls_eci" ||
    sourceId === "major_company_filings" ||
    sourceType === "openai_official" ||
    sourceType === "macro_official" ||
    sourceType === "regulatory_official" ||
    sourceType === "company_filing"
  ) {
    return "primary";
  }

  return "precision";
}
