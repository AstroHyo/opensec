import Parser from "rss-parser";
import type { AppConfig } from "../config.js";
import type { OpenAICategory, SourceItemInput } from "../types.js";
import { collapseWhitespace } from "../util/text.js";

const parser = new Parser();

export async function fetchOpenAiNewsItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const feed = await parser.parseURL(config.sourceUrls.openaiNewsRss);
  const items: SourceItemInput[] = [];

  for (const entry of (feed.items ?? []).slice(0, 60)) {
    const link = entry.link ?? entry.id;
    if (!link) {
      continue;
    }

    const category = normalizeOpenAiCategory((entry.categories?.[0] ?? "Company").trim());
    const title = collapseWhitespace(entry.title ?? "Untitled OpenAI news item");
    const description = collapseWhitespace(entry.contentSnippet ?? entry.content ?? "");

    items.push({
      sourceId: "openai_news",
      sourceType: "openai_official",
      sourceLayer: "primary",
      sourceLabel: categoryToSourceLabel(category),
      sourceAuthority: 100,
      externalId: link,
      title,
      description,
      contentText: description,
      sourceUrl: link,
      canonicalUrl: link,
      originalUrl: link,
      publishedAt: entry.isoDate ?? entry.pubDate ?? fetchedAt,
      fetchedAt,
      itemKind: categoryToItemKind(category),
      openaiCategory: category,
      metadata: {
        rssCategory: entry.categories?.[0] ?? null,
        sectionPageUrl: categoryToSectionUrl(config, category)
      },
      rawPayload: {
        title: entry.title,
        description: entry.contentSnippet ?? entry.content ?? "",
        link,
        category: entry.categories?.[0] ?? null
      }
    });
  }

  return items;
}

function normalizeOpenAiCategory(raw: string): OpenAICategory {
  const normalized = raw.toLowerCase();
  if (normalized.includes("product") || normalized.includes("api")) {
    return "Product";
  }
  if (normalized.includes("research") || normalized.includes("publication")) {
    return "Research";
  }
  if (normalized.includes("engineering")) {
    return "Engineering";
  }
  if (normalized.includes("safety")) {
    return "Safety";
  }
  if (normalized.includes("security")) {
    return "Security";
  }
  return "Company";
}

function categoryToSourceLabel(category: OpenAICategory): string {
  return `OpenAI / ${category}`;
}

function categoryToSectionUrl(config: AppConfig, category: OpenAICategory): string {
  switch (category) {
    case "Product":
      return config.sourceUrls.openaiSections[1]?.url ?? config.sourceUrls.openaiSections[0].url;
    case "Research":
      return config.sourceUrls.openaiSections[2]?.url ?? config.sourceUrls.openaiSections[0].url;
    case "Company":
      return config.sourceUrls.openaiSections[3]?.url ?? config.sourceUrls.openaiSections[0].url;
    default:
      return config.sourceUrls.openaiSections[0].url;
  }
}

function categoryToItemKind(category: OpenAICategory): SourceItemInput["itemKind"] {
  switch (category) {
    case "Product":
      return "product";
    case "Research":
      return "research";
    case "Engineering":
      return "engineering";
    case "Safety":
      return "safety";
    case "Security":
      return "security";
    case "Company":
    case "External Coverage":
    default:
      return "company";
  }
}
