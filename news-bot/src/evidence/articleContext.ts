import { load as loadHtml } from "cheerio";
import type { AppConfig } from "../config.js";
import type { NewsDatabase } from "../db.js";
import type { ArticleContextRecord, DigestEntry } from "../types.js";
import { sha256Hex } from "../util/canonicalize.js";
import { fetchText } from "../util/http.js";
import { collapseWhitespace, truncate, uniqueStrings } from "../util/text.js";

const MAX_CLEAN_TEXT_CHARS = 10_000;
const MAX_EVIDENCE_SPANS = 4;
const MAX_KEY_SECTIONS = 4;

export async function ensureArticleContexts(input: {
  db: NewsDatabase;
  config: AppConfig;
  items: DigestEntry[];
  fetchedAt: string;
}): Promise<Map<number, ArticleContextRecord>> {
  const contexts = new Map<number, ArticleContextRecord>();

  for (const item of input.items) {
    const sourceHash = buildArticleContextSourceHash(item);
    const cached = input.db.getArticleContext(item.itemId, sourceHash) ?? input.db.getLatestArticleContext(item.itemId);

    if (cached && cached.canonicalUrl === item.primaryUrl) {
      contexts.set(item.itemId, cached);
      continue;
    }

    const extracted = await fetchArticleContext({
      config: input.config,
      item,
      sourceHash,
      fetchedAt: input.fetchedAt
    });

    const saved = input.db.saveArticleContext({
      itemId: item.itemId,
      sourceHash,
      canonicalUrl: extracted.canonicalUrl,
      fetchStatus: extracted.fetchStatus,
      publisher: extracted.publisher ?? null,
      author: extracted.author ?? null,
      publishedAt: extracted.publishedAt ?? null,
      headline: extracted.headline,
      dek: extracted.dek ?? null,
      cleanText: extracted.cleanText,
      keySections: extracted.keySections,
      evidenceSnippets: extracted.evidenceSnippets,
      wordCount: extracted.wordCount,
      fetchedAt: extracted.fetchedAt
    });

    contexts.set(item.itemId, saved);
  }

  return contexts;
}

export function embedArticleContexts(items: DigestEntry[], contexts: Map<number, ArticleContextRecord>): void {
  for (const item of items) {
    const articleContext = contexts.get(item.itemId);
    if (!articleContext) {
      continue;
    }

    const metadata = { ...item.metadata };
    metadata.articleContext = {
      fetchStatus: articleContext.fetchStatus,
      publisher: articleContext.publisher ?? null,
      author: articleContext.author ?? null,
      publishedAt: articleContext.publishedAt ?? null,
      headline: articleContext.headline,
      dek: articleContext.dek ?? null,
      cleanText: articleContext.cleanText,
      keySections: articleContext.keySections,
      evidenceSnippets: articleContext.evidenceSnippets,
      wordCount: articleContext.wordCount
    };
    item.metadata = metadata;

    if (!item.evidenceSpans || item.evidenceSpans.length === 0) {
      item.evidenceSpans = articleContext.evidenceSnippets;
    }
  }
}

export function buildArticleContextSourceHash(item: DigestEntry): string {
  return sha256Hex(
    JSON.stringify({
      itemId: item.itemId,
      title: item.title,
      primaryUrl: item.primaryUrl,
      description: item.description ?? null,
      contentSnippet: item.contentSnippet ?? null,
      repoLanguage: item.repoLanguage ?? null,
      repoStarsToday: item.repoStarsToday ?? null,
      keywords: item.keywords
    })
  );
}

export async function fetchArticleContext(input: {
  config: AppConfig;
  item: DigestEntry;
  sourceHash: string;
  fetchedAt: string;
}): Promise<Omit<ArticleContextRecord, "id" | "itemId">> {
  try {
    const html = await fetchText(input.item.primaryUrl, input.config.httpTimeoutMs);
    const extracted = extractArticleContextFromHtml({
      item: input.item,
      html,
      canonicalUrl: input.item.primaryUrl
    });

    return {
      sourceHash: input.sourceHash,
      canonicalUrl: extracted.canonicalUrl,
      fetchStatus: extracted.fetchStatus,
      publisher: extracted.publisher,
      author: extracted.author,
      publishedAt: extracted.publishedAt,
      headline: extracted.headline,
      dek: extracted.dek,
      cleanText: extracted.cleanText,
      keySections: extracted.keySections,
      evidenceSnippets: extracted.evidenceSnippets,
      wordCount: extracted.wordCount,
      fetchedAt: input.fetchedAt
    };
  } catch {
    const fallback = buildFallbackArticleContext(input.item);
    return {
      sourceHash: input.sourceHash,
      canonicalUrl: input.item.primaryUrl,
      fetchStatus: fallback.fetchStatus,
      publisher: fallback.publisher,
      author: fallback.author,
      publishedAt: fallback.publishedAt,
      headline: fallback.headline,
      dek: fallback.dek,
      cleanText: fallback.cleanText,
      keySections: fallback.keySections,
      evidenceSnippets: fallback.evidenceSnippets,
      wordCount: fallback.wordCount,
      fetchedAt: input.fetchedAt
    };
  }
}

export function extractArticleContextFromHtml(input: {
  item: DigestEntry;
  html: string;
  canonicalUrl: string;
}): Omit<ArticleContextRecord, "id" | "itemId" | "sourceHash" | "fetchedAt"> {
  const url = new URL(input.canonicalUrl);

  if (url.hostname === "github.com" && input.item.repoStarsToday != null) {
    return extractGithubRepoContext(input.item, input.html, input.canonicalUrl);
  }

  return extractGenericArticleContext(input.item, input.html, input.canonicalUrl);
}

function extractGenericArticleContext(
  item: DigestEntry,
  html: string,
  canonicalUrl: string
): Omit<ArticleContextRecord, "id" | "itemId" | "sourceHash" | "fetchedAt"> {
  const $ = loadHtml(html);
  sanitizeDocument($);

  const headline =
    firstText([
      $('meta[property="og:title"]').attr("content"),
      $('meta[name="twitter:title"]').attr("content"),
      $("article h1").first().text(),
      $("main h1").first().text(),
      $("h1").first().text(),
      item.title
    ]) ?? item.title;

  const dek =
    firstText([
      $('meta[property="og:description"]').attr("content"),
      $('meta[name="description"]').attr("content"),
      $('main h2').first().text(),
      $('article h2').first().text()
    ]) ?? null;

  const publisher =
    firstText([
      $('meta[property="og:site_name"]').attr("content"),
      $('meta[name="application-name"]').attr("content"),
      $('[rel="publisher"]').first().text()
    ]) ?? hostLabel(canonicalUrl);

  const author =
    firstText([
      $('meta[name="author"]').attr("content"),
      $('[rel="author"]').first().text(),
      $('[itemprop="author"]').first().text()
    ]) ?? null;

  const publishedAt =
    firstText([
      $('meta[property="article:published_time"]').attr("content"),
      $("time[datetime]").first().attr("datetime")
    ]) ?? null;

  const textBlocks = extractTextBlocks($);
  const cleanText = truncate(textBlocks.join("\n\n"), MAX_CLEAN_TEXT_CHARS);
  const keySections = buildKeySections(textBlocks, dek);
  const evidenceSnippets = buildEvidenceSnippets(textBlocks, dek);

  return {
    canonicalUrl,
    fetchStatus: cleanText.length > 160 ? "ok" : "fallback",
    publisher,
    author,
    publishedAt,
    headline,
    dek,
    cleanText: cleanText.length > 0 ? cleanText : fallbackCleanText(item),
    keySections: keySections.length > 0 ? keySections : [fallbackCleanText(item)],
    evidenceSnippets: evidenceSnippets.length > 0 ? evidenceSnippets : [fallbackEvidence(item)],
    wordCount: wordCount(cleanText)
  };
}

function extractGithubRepoContext(
  item: DigestEntry,
  html: string,
  canonicalUrl: string
): Omit<ArticleContextRecord, "id" | "itemId" | "sourceHash" | "fetchedAt"> {
  const $ = loadHtml(html);
  sanitizeDocument($);

  const headline =
    firstText([
      $('meta[property="og:title"]').attr("content"),
      $("strong[itemprop='name'] a").text(),
      item.title
    ]) ?? item.title;
  const dek =
    firstText([
      $('meta[property="og:description"]').attr("content"),
      $('meta[name="description"]').attr("content"),
      $("p.f4.my-3").first().text()
    ]) ?? item.description ?? null;

  const readmeBlocks = uniqueStrings(
    $("#readme article p, #readme article li, #readme .markdown-body p, #readme .markdown-body li")
      .map((_, node) => collapseWhitespace($(node).text()))
      .get()
      .filter((value) => value.length >= 50)
  );

  const releaseBlocks = uniqueStrings(
    $("a[href*='/releases'], a[href*='/blob/'], a[href*='/tree/']")
      .slice(0, 8)
      .map((_, node) => collapseWhitespace($(node).text()))
      .get()
      .filter((value) => value.length >= 8)
  );

  const cleanText = truncate([...readmeBlocks, ...releaseBlocks].join("\n\n"), MAX_CLEAN_TEXT_CHARS);
  const evidenceSnippets = buildEvidenceSnippets(readmeBlocks, dek);
  const keySections = buildKeySections(readmeBlocks, dek);

  return {
    canonicalUrl,
    fetchStatus: cleanText.length > 120 ? "ok" : "fallback",
    publisher: "GitHub",
    author: null,
    publishedAt: null,
    headline,
    dek,
    cleanText: cleanText.length > 0 ? cleanText : fallbackCleanText(item),
    keySections: keySections.length > 0 ? keySections : [fallbackCleanText(item)],
    evidenceSnippets: evidenceSnippets.length > 0 ? evidenceSnippets : [fallbackEvidence(item)],
    wordCount: wordCount(cleanText)
  };
}

function buildFallbackArticleContext(
  item: DigestEntry
): Omit<ArticleContextRecord, "id" | "itemId" | "sourceHash" | "fetchedAt" | "canonicalUrl"> & {
  canonicalUrl?: string;
} {
  const cleanText = fallbackCleanText(item);
  return {
    fetchStatus: "fallback",
    publisher: item.sourceLabel,
    author: null,
    publishedAt: null,
    headline: item.title,
    dek: item.description ?? null,
    cleanText,
    keySections: [cleanText],
    evidenceSnippets: [fallbackEvidence(item)],
    wordCount: wordCount(cleanText)
  };
}

function sanitizeDocument($: ReturnType<typeof loadHtml>): void {
  $("script, style, noscript, svg, iframe, form, nav, footer, header, aside, button").remove();
}

function extractTextBlocks($: ReturnType<typeof loadHtml>): string[] {
  const candidates = [
    $("article").first(),
    $("main").first(),
    $("[role='main']").first(),
    $("body").first()
  ].filter((candidate) => candidate.length > 0);

  const best = candidates
    .map((candidate) => ({
      candidate,
      score: candidate.text().length
    }))
    .sort((left, right) => right.score - left.score)[0]?.candidate;

  if (!best || best.length === 0) {
    return [];
  }

  const directBlocks = uniqueStrings(
    best
      .find("p, li, blockquote")
      .map((_, node) => collapseWhitespace($(node).text()))
      .get()
      .filter((value) => value.length >= 45)
  );

  if (directBlocks.length >= 3) {
    return directBlocks.slice(0, 18);
  }

  return uniqueStrings(
    best
      .text()
      .split(/\n+/)
      .map((value) => collapseWhitespace(value))
      .filter((value) => value.length >= 45)
  ).slice(0, 18);
}

function buildKeySections(textBlocks: string[], dek?: string | null): string[] {
  return uniqueStrings([dek ?? "", ...textBlocks.map((value) => truncate(value, 220))])
    .filter((value) => value.length >= 30)
    .slice(0, MAX_KEY_SECTIONS);
}

function buildEvidenceSnippets(textBlocks: string[], dek?: string | null): string[] {
  return uniqueStrings(
    [...textBlocks]
      .sort((left, right) => right.length - left.length)
      .map((value) => truncate(value, 240))
      .concat(dek ? [truncate(dek, 200)] : [])
  )
    .filter((value) => value.length >= 30)
    .slice(0, MAX_EVIDENCE_SPANS);
}

function fallbackCleanText(item: DigestEntry): string {
  return collapseWhitespace(item.contentSnippet ?? item.description ?? item.title);
}

function fallbackEvidence(item: DigestEntry): string {
  return truncate(collapseWhitespace(item.description ?? item.contentSnippet ?? item.title), 220);
}

function firstText(values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    const collapsed = collapseWhitespace(value ?? "");
    if (collapsed.length > 0) {
      return collapsed;
    }
  }

  return null;
}

function wordCount(value: string): number {
  if (!value.trim()) {
    return 0;
  }
  return value.trim().split(/\s+/).length;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
