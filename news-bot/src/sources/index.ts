import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import type { SourceRunSummary } from "../types.js";
import { fetchGeekNewsItems } from "./geeknews.js";
import { fetchGithubTrendingItems } from "./githubTrending.js";
import { fetchOpenAiNewsItems } from "./openaiNews.js";

export async function collectAndStoreSources(
  db: NewsDatabase,
  config: AppConfig,
  now: DateTime
): Promise<SourceRunSummary[]> {
  const fetchedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const tasks = [
    {
      sourceId: "geeknews" as const,
      fetcher: () => fetchGeekNewsItems(config, fetchedAt)
    },
    {
      sourceId: "openai_news" as const,
      fetcher: () => fetchOpenAiNewsItems(config, fetchedAt)
    },
    {
      sourceId: "github_trending" as const,
      fetcher: () => fetchGithubTrendingItems(config, fetchedAt)
    }
  ];

  const summaries: SourceRunSummary[] = [];

  for (const task of tasks) {
    const runId = db.startSourceRun(task.sourceId, fetchedAt);
    try {
      const items = await task.fetcher();
      let normalized = 0;
      for (const item of items) {
        db.upsertNormalizedItem(item);
        normalized += 1;
      }

      const summary: SourceRunSummary = {
        sourceId: task.sourceId,
        itemsFetched: items.length,
        itemsNormalized: normalized
      };
      db.finishSourceRun(runId, summary);
      summaries.push(summary);
    } catch (error) {
      const summary: SourceRunSummary = {
        sourceId: task.sourceId,
        itemsFetched: 0,
        itemsNormalized: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
      db.finishSourceRun(runId, summary);
      summaries.push(summary);
    }
  }

  return summaries;
}
