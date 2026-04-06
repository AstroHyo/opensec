import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import type { SourceRunSummary } from "../types.js";
import { fetchBlueskySignalEvents } from "./blueskySignals.js";
import { fetchGeekNewsItems } from "./geeknews.js";
import { fetchGithubTrendingItems } from "./githubTrending.js";
import { fetchHackerNewsItems } from "./hackerNews.js";
import { fetchOpenAiNewsItems } from "./openaiNews.js";
import { fetchTechmemeItems } from "./techmeme.js";

export async function collectAndStoreSources(
  db: NewsDatabase,
  config: AppConfig,
  now: DateTime
): Promise<SourceRunSummary[]> {
  const fetchedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const primaryAndPrecisionTasks = [
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
    },
    {
      sourceId: "techmeme" as const,
      fetcher: () => fetchTechmemeItems(config, fetchedAt)
    },
    {
      sourceId: "hacker_news" as const,
      fetcher: () => fetchHackerNewsItems(config, fetchedAt)
    }
  ];

  const summaries: SourceRunSummary[] = [];

  for (const task of primaryAndPrecisionTasks) {
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

  const signalRunId = db.startSourceRun("bluesky_watch", fetchedAt);
  try {
    const events = await fetchBlueskySignalEvents(config, fetchedAt);
    db.saveSignalEvents(events);
    db.matchRecentSignalEvents(now.toUTC().minus({ hours: config.sourcing.signalWindowHours }).toISO() ?? fetchedAt);

    const summary: SourceRunSummary = {
      sourceId: "bluesky_watch",
      itemsFetched: events.length,
      itemsNormalized: 0
    };
    db.finishSourceRun(signalRunId, summary);
    summaries.push(summary);
  } catch (error) {
    const summary: SourceRunSummary = {
      sourceId: "bluesky_watch",
      itemsFetched: 0,
      itemsNormalized: 0,
      errors: [error instanceof Error ? error.message : String(error)]
    };
    db.finishSourceRun(signalRunId, summary);
    summaries.push(summary);
  }

  return summaries;
}
