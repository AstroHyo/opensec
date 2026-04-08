import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { getProfileConfig } from "../profiles.js";
import type { ProfileKey, SourceItemInput, SourceRunSummary } from "../types.js";
import { fetchBlueskySignalEvents } from "./blueskySignals.js";
import {
  fetchFederalReserveItems,
  fetchMajorCompanyFilings,
  fetchSecPressItems,
  fetchSingleBlsReleaseItem,
  fetchTreasuryPressItems
} from "./financeSources.js";
import { fetchGeekNewsItems } from "./geeknews.js";
import { fetchGithubTrendingItems } from "./githubTrending.js";
import { fetchHackerNewsItems } from "./hackerNews.js";
import { fetchOpenAiNewsItems } from "./openaiNews.js";
import { fetchTechmemeItems } from "./techmeme.js";

export async function collectAndStoreSources(
  db: NewsDatabase,
  config: AppConfig,
  now: DateTime,
  profileKey: ProfileKey,
  options?: { includeEarlyWarning?: boolean }
): Promise<SourceRunSummary[]> {
  const fetchedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const includeEarlyWarning = options?.includeEarlyWarning ?? true;
  const sourceIds = new Set(getProfileConfig(profileKey).sourceIds);
  const primaryAndPrecisionTasks: Array<{
    sourceId: SourceRunSummary["sourceId"];
    fetcher: () => Promise<SourceItemInput[]>;
  }> = [];

  if (sourceIds.has("geeknews")) {
    primaryAndPrecisionTasks.push({
      sourceId: "geeknews",
      fetcher: () => fetchGeekNewsItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("openai_news")) {
    primaryAndPrecisionTasks.push({
      sourceId: "openai_news",
      fetcher: () => fetchOpenAiNewsItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("github_trending")) {
    primaryAndPrecisionTasks.push({
      sourceId: "github_trending",
      fetcher: () => fetchGithubTrendingItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("techmeme")) {
    primaryAndPrecisionTasks.push({
      sourceId: "techmeme",
      fetcher: () => fetchTechmemeItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("hacker_news")) {
    primaryAndPrecisionTasks.push({
      sourceId: "hacker_news",
      fetcher: () => fetchHackerNewsItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("fed_press")) {
    primaryAndPrecisionTasks.push({
      sourceId: "fed_press",
      fetcher: () => fetchFederalReserveItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("sec_press")) {
    primaryAndPrecisionTasks.push({
      sourceId: "sec_press",
      fetcher: () => fetchSecPressItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("treasury_press")) {
    primaryAndPrecisionTasks.push({
      sourceId: "treasury_press",
      fetcher: () => fetchTreasuryPressItems(config, fetchedAt)
    });
  }
  if (sourceIds.has("bls_cpi")) {
    primaryAndPrecisionTasks.push({
      sourceId: "bls_cpi",
      fetcher: async () => {
        const item = await fetchSingleBlsReleaseItem(config, fetchedAt, "bls_cpi");
        return item ? [item] : [];
      }
    });
  }
  if (sourceIds.has("bls_jobs")) {
    primaryAndPrecisionTasks.push({
      sourceId: "bls_jobs",
      fetcher: async () => {
        const item = await fetchSingleBlsReleaseItem(config, fetchedAt, "bls_jobs");
        return item ? [item] : [];
      }
    });
  }
  if (sourceIds.has("bls_ppi")) {
    primaryAndPrecisionTasks.push({
      sourceId: "bls_ppi",
      fetcher: async () => {
        const item = await fetchSingleBlsReleaseItem(config, fetchedAt, "bls_ppi");
        return item ? [item] : [];
      }
    });
  }
  if (sourceIds.has("bls_eci")) {
    primaryAndPrecisionTasks.push({
      sourceId: "bls_eci",
      fetcher: async () => {
        const item = await fetchSingleBlsReleaseItem(config, fetchedAt, "bls_eci");
        return item ? [item] : [];
      }
    });
  }
  if (sourceIds.has("major_company_filings")) {
    primaryAndPrecisionTasks.push({
      sourceId: "major_company_filings",
      fetcher: () => fetchMajorCompanyFilings(config, fetchedAt)
    });
  }

  const summaries: SourceRunSummary[] = [];

  for (const task of primaryAndPrecisionTasks) {
    const runId = db.startSourceRun(task.sourceId, profileKey, fetchedAt);
    try {
      const items = await task.fetcher();
      let normalized = 0;
      for (const item of items) {
        db.upsertNormalizedItem(item);
        normalized += 1;
      }

      const summary: SourceRunSummary = {
        profileKey,
        sourceId: task.sourceId,
        itemsFetched: items.length,
        itemsNormalized: normalized
      };
      db.finishSourceRun(runId, summary);
      summaries.push(summary);
    } catch (error) {
      const summary: SourceRunSummary = {
        profileKey,
        sourceId: task.sourceId,
        itemsFetched: 0,
        itemsNormalized: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
      db.finishSourceRun(runId, summary);
      summaries.push(summary);
    }
  }

  if (includeEarlyWarning) {
    const signalRunId = db.startSourceRun("bluesky_watch", profileKey, fetchedAt);
    try {
      const events = await fetchBlueskySignalEvents(config, fetchedAt);
      db.saveSignalEvents(events);
      db.matchRecentSignalEvents(now.toUTC().minus({ hours: config.sourcing.signalWindowHours }).toISO() ?? fetchedAt);

      const summary: SourceRunSummary = {
        profileKey,
        sourceId: "bluesky_watch",
        itemsFetched: events.length,
        itemsNormalized: 0
      };
      db.finishSourceRun(signalRunId, summary);
      summaries.push(summary);
    } catch (error) {
      const summary: SourceRunSummary = {
        profileKey,
        sourceId: "bluesky_watch",
        itemsFetched: 0,
        itemsNormalized: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
      db.finishSourceRun(signalRunId, summary);
      summaries.push(summary);
    }
  }

  return summaries;
}
