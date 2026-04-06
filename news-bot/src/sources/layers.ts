import type { SourceId, SourceLayer, SourceType } from "../types.js";

export function inferSourceLayer(sourceId: SourceId, sourceType?: SourceType): SourceLayer {
  if (sourceId === "bluesky_watch" || sourceType === "social_signal") {
    return "early_warning";
  }

  if (sourceId === "openai_news" || sourceId === "github_trending" || sourceType === "openai_official") {
    return "primary";
  }

  return "precision";
}
