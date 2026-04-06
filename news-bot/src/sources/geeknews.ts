import { load } from "cheerio";
import Parser from "rss-parser";
import type { AppConfig } from "../config.js";
import type { GeekNewsKind, SourceItemInput } from "../types.js";
import { fetchText } from "../util/http.js";
import { collapseWhitespace, stripHtml } from "../util/text.js";

const parser = new Parser();

export async function fetchGeekNewsItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const feed = await parser.parseURL(config.sourceUrls.geeknewsRss);
  const entries = (feed.items ?? []).slice(0, 25);
  const items: SourceItemInput[] = [];

  for (const entry of entries) {
    const discussionUrl = entry.link ?? entry.id;
    if (!discussionUrl) {
      continue;
    }

    const title = collapseWhitespace(entry.title ?? "Untitled GeekNews item");
    const geeknewsKind = detectGeekNewsKind(title);
    const detail = await fetchGeekNewsDetail(discussionUrl, config.httpTimeoutMs).catch(() => null);
    const topicId = new URL(discussionUrl).searchParams.get("id") ?? title;
    const description = stripHtml((entry as { content?: string }).content);

    items.push({
      sourceId: "geeknews",
      sourceType: "geeknews",
      sourceLayer: "precision",
      sourceLabel: `GeekNews / ${capitalize(geeknewsKind)}`,
      sourceAuthority: 62,
      externalId: topicId,
      title,
      description,
      contentText: description,
      sourceUrl: discussionUrl,
      canonicalUrl: detail?.originalUrl ?? discussionUrl,
      originalUrl: detail?.originalUrl ?? discussionUrl,
      publishedAt: entry.isoDate ?? entry.pubDate ?? fetchedAt,
      fetchedAt,
      itemKind: geeknewsKind,
      geeknewsKind,
      metadata: {
        geeknewsDiscussionUrl: discussionUrl,
        originalDomain: detail?.originalDomain ?? null,
        points: detail?.points ?? null
      },
      rawPayload: {
        title: entry.title,
        content: (entry as { content?: string }).content,
        link: discussionUrl
      }
    });
  }

  return items;
}

async function fetchGeekNewsDetail(
  discussionUrl: string,
  timeoutMs: number
): Promise<{ originalUrl?: string; originalDomain?: string; points?: number }> {
  const html = await fetchText(discussionUrl, timeoutMs);
  const $ = load(html);

  const originalUrl = $("div.topictitle.link a.bold.ud").first().attr("href")?.trim();
  const pointsText = $("span[id^='tp']").first().text().trim();
  const points = Number.parseInt(pointsText, 10);

  return {
    originalUrl,
    originalDomain: $(".topicurl").first().text().replace(/[()]/g, "").trim() || undefined,
    points: Number.isFinite(points) ? points : undefined
  };
}

function detectGeekNewsKind(title: string): GeekNewsKind {
  if (/^ask\s+gn:/i.test(title)) {
    return "ask";
  }
  if (/^show\s+gn:/i.test(title)) {
    return "show";
  }
  return "news";
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
