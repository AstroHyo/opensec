import type { AppConfig } from "../config.js";
import type { SourceItemInput } from "../types.js";
import { fetchJson } from "../util/http.js";
import { collapseWhitespace, stripHtml } from "../util/text.js";
import { isAiToolingRelevantText } from "./relevance.js";

export interface HackerNewsItemPayload {
  id: number;
  by?: string;
  descendants?: number;
  score?: number;
  text?: string;
  time?: number;
  title?: string;
  type?: string;
  url?: string;
}

export async function fetchHackerNewsItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const apiBase = config.sourceUrls.hackerNewsApiBase.replace(/\/+$/, "");
  const [topIds, newIds] = await Promise.all([
    fetchJson<number[]>(`${apiBase}/topstories.json`, config.httpTimeoutMs),
    fetchJson<number[]>(`${apiBase}/newstories.json`, config.httpTimeoutMs)
  ]);

  const topSet = new Set(topIds.slice(0, config.sourcing.hnTopLimit));
  const newSet = new Set(newIds.slice(0, config.sourcing.hnNewLimit));
  const storyIds = [...new Set([...topSet, ...newSet])];

  const rawItems = await Promise.all(
    storyIds.map((storyId) =>
      fetchJson<HackerNewsItemPayload>(`${apiBase}/item/${storyId}.json`, config.httpTimeoutMs).catch(() => null)
    )
  );

  return rawItems
    .map((item) => normalizeHackerNewsItem(item, fetchedAt, { topSet, newSet }))
    .filter((item): item is SourceItemInput => Boolean(item));
}

export function normalizeHackerNewsItem(
  payload: HackerNewsItemPayload | null,
  fetchedAt: string,
  ranking: { topSet: Set<number>; newSet: Set<number> }
): SourceItemInput | null {
  if (!payload || payload.type !== "story" || !payload.url || !payload.title || !isHttpUrl(payload.url)) {
    return null;
  }

  const title = collapseWhitespace(payload.title);
  const description = stripHtml(payload.text);
  if (!isAiToolingRelevantText(title, description, payload.url)) {
    return null;
  }

  const inTop = ranking.topSet.has(payload.id);
  const inNew = ranking.newSet.has(payload.id);
  const rankingLabel = inTop && inNew ? "Top+New" : inTop ? "Top" : "New";
  const publishedAt = payload.time ? new Date(payload.time * 1000).toISOString() : fetchedAt;

  return {
    sourceId: "hacker_news",
    sourceType: "hacker_news",
    sourceLayer: "precision",
    sourceLabel: `Hacker News / ${rankingLabel}`,
    sourceAuthority: 60,
    externalId: String(payload.id),
    title,
    description,
    contentText: description,
    sourceUrl: `https://news.ycombinator.com/item?id=${payload.id}`,
    canonicalUrl: payload.url,
    originalUrl: payload.url,
    publishedAt,
    fetchedAt,
    itemKind: "news",
    metadata: {
      hnId: payload.id,
      hnDiscussionUrl: `https://news.ycombinator.com/item?id=${payload.id}`,
      rankingLabel,
      score: payload.score ?? 0,
      comments: payload.descendants ?? 0,
      by: payload.by ?? null
    },
    rawPayload: payload
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
