import { load } from "cheerio";
import type { AppConfig } from "../config.js";
import type { SourceItemInput } from "../types.js";
import { fetchText } from "../util/http.js";
import { collapseWhitespace, truncate } from "../util/text.js";
import { isAiToolingRelevantText } from "./relevance.js";

export async function fetchTechmemeItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const html = await fetchText(config.sourceUrls.techmemeHome, config.httpTimeoutMs);
  return parseTechmemeHomepage(html, config.sourceUrls.techmemeHome, fetchedAt);
}

export function parseTechmemeHomepage(html: string, homeUrl: string, fetchedAt: string): SourceItemInput[] {
  const $ = load(html);
  const items: SourceItemInput[] = [];

  $("span[id^='s'][pml]").each((_, element) => {
    const span = $(element);
    const spanId = span.attr("id")?.trim();
    const permalinkToken = span.attr("pml")?.trim();
    if (!spanId || !permalinkToken) {
      return;
    }

    const match = spanId.match(/^s(\d+)i(\d+)$/);
    if (!match) {
      return;
    }

    const clusterIndex = Number.parseInt(match[1], 10);
    const clusterItemIndex = Number.parseInt(match[2], 10);
    const container = span.closest("table.shrtbl").nextAll("div.ii").first();
    const anchor = container.find("a.ourh").first();
    const href = anchor.attr("href")?.trim();
    const title = collapseWhitespace(anchor.text());
    if (!href || !title || !isHttpUrl(href)) {
      return;
    }

    const containerClone = container.clone();
    containerClone.find("a.f").remove();
    const fullText = collapseWhitespace(containerClone.text());
    const description = extractTechmemeDescription(fullText, title);
    if (!isAiToolingRelevantText(title, description)) {
      return;
    }

    const permalink = techmemePermalink(homeUrl, permalinkToken);
    const isLeadCluster = clusterItemIndex === 1;
    items.push({
      sourceId: "techmeme",
      sourceType: "techmeme",
      sourceLayer: "precision",
      sourceLabel: isLeadCluster ? "Techmeme / Lead" : "Techmeme / Related",
      sourceAuthority: 68,
      externalId: permalinkToken,
      title,
      description,
      contentText: description,
      sourceUrl: permalink,
      canonicalUrl: href,
      originalUrl: href,
      publishedAt: fetchedAt,
      fetchedAt,
      itemKind: "news",
      metadata: {
        techmemePermalink: permalink,
        clusterIndex,
        clusterItemIndex,
        isLeadCluster,
        techmemeSocialPostUrl: span.attr("bsurl")?.trim() ?? null
      },
      rawPayload: {
        spanId,
        permalinkToken,
        href,
        title,
        description
      }
    });
  });

  return items;
}

function extractTechmemeDescription(fullText: string, title: string): string {
  if (!fullText) {
    return "";
  }

  const withoutTitle = collapseWhitespace(fullText.replace(title, "").replace(/^[-–—:\s]+/, ""));
  return truncate(withoutTitle.replace(/\bFind\b$/i, "").trim(), 220);
}

function techmemePermalink(homeUrl: string, token: string): string {
  const [datePart, storyPart] = token.split("p");
  const base = new URL(homeUrl).origin;
  return `${base}/${datePart}/p${storyPart}#a${token}`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
