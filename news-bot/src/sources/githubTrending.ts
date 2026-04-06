import { load } from "cheerio";
import type { AppConfig } from "../config.js";
import type { SourceItemInput } from "../types.js";
import { fetchText } from "../util/http.js";
import { collapseWhitespace } from "../util/text.js";

export async function fetchGithubTrendingItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const pageResults = await Promise.all(
    config.sourceUrls.githubTrending.map(async (page) => {
      const html = await fetchText(page.url, config.httpTimeoutMs);
      return parseTrendingPage(page.label, page.url, html, fetchedAt);
    })
  );

  return pageResults.flat();
}

function parseTrendingPage(
  sourceLabel: string,
  pageUrl: string,
  html: string,
  fetchedAt: string
): SourceItemInput[] {
  const $ = load(html);
  const items: SourceItemInput[] = [];

  $("article.Box-row").each((index, element) => {
    const repoPath = $(element).find("h2 a").first().attr("href");
    if (!repoPath) {
      return;
    }

    const fullName = collapseWhitespace($(element).find("h2 a").first().text()).replace(/\s+/g, "");
    const [repoOwner, repoName] = fullName.split("/");
    if (!repoOwner || !repoName) {
      return;
    }

    const description = collapseWhitespace($(element).find("p").first().text());
    const repoLanguage = collapseWhitespace($(element).find("[itemprop='programmingLanguage']").first().text()) || undefined;
    const repoStarsTotal = parseCompactNumber($(element).find("a[href$='/stargazers']").first().text());
    const repoStarsToday = parseCompactNumber(
      $(element)
        .find("span")
        .toArray()
        .map((node) => $(node).text())
        .find((text) => text.includes("stars today")) ?? ""
    );
    const repoUrl = new URL(repoPath, "https://github.com").toString();

    items.push({
      sourceId: "github_trending",
      sourceType: "github_trending",
      sourceLayer: "primary",
      sourceLabel,
      sourceAuthority: 74,
      externalId: `${sourceLabel}:${repoOwner}/${repoName}`,
      title: `${repoOwner}/${repoName}`,
      description,
      contentText: description,
      sourceUrl: pageUrl,
      canonicalUrl: repoUrl,
      originalUrl: repoUrl,
      publishedAt: fetchedAt,
      fetchedAt,
      itemKind: "repo",
      repoOwner,
      repoName,
      repoLanguage,
      repoStarsToday,
      repoStarsTotal,
      metadata: {
        trendingPageUrl: pageUrl,
        pageLabel: sourceLabel,
        rank: index + 1
      },
      rawPayload: {
        fullName,
        description,
        repoLanguage,
        repoStarsToday,
        repoStarsTotal,
        pageUrl
      }
    });
  });

  return items;
}

function parseCompactNumber(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
