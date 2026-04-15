import fs from "node:fs";
import { randomInt } from "node:crypto";
import type { AppConfig } from "../config.js";
import { collapseWhitespace, uniqueStrings } from "../util/text.js";
import type { HousingCandidateForAdjudication, XiaohongshuNoteDetail, XiaohongshuSearchResult } from "./types.js";
import type { BrowserContext, Page } from "playwright";

const SEARCH_WAIT_MS = 2_500;
const NOTE_WAIT_MS = 2_000;
const MAX_IMAGE_URLS = 8;
const HUMAN_DELAY_MIN_MS = 5_000;
const HUMAN_DELAY_MAX_MS = 9_000;
const SCROLL_DELAY_MIN_MS = 5_000;
const SCROLL_DELAY_MAX_MS = 8_000;

interface SearchCollectionSnapshot {
  results: XiaohongshuSearchResult[];
  stateResultCount: number;
  domResultCount: number;
  domAnchorCount: number;
  hasInitialState: boolean;
  pageTitle: string;
  currentUrl: string;
  bodyLength: number;
  bodySnippet: string;
  loginPromptDetected: boolean;
  riskPromptDetected: boolean;
}

type SearchDiagnosisKind = "results_found" | "login_gate" | "risk_blocked" | "dom_unreadable" | "real_zero";

interface SearchDiagnosis {
  kind: SearchDiagnosisKind;
  readableSurfaceDetected: boolean;
  message: string;
}

interface SearchAttemptResult {
  results: XiaohongshuSearchResult[];
  snapshots: SearchCollectionSnapshot[];
  diagnosis: SearchDiagnosis;
}

export async function withPersistentXiaohongshuContext<T>(
  config: AppConfig,
  callback: (context: BrowserContext) => Promise<T>,
  options?: { headless?: boolean }
): Promise<T> {
  fs.mkdirSync(config.housingWatcher.profileDir, { recursive: true });
  const chromium = await getChromium();
  const context = await chromium.launchPersistentContext(config.housingWatcher.profileDir, {
    headless: options?.headless ?? config.housingWatcher.headless,
    viewport: { width: 1400, height: 1800 }
  });

  try {
    return await callback(context);
  } finally {
    await context.close();
  }
}

async function getChromium() {
  const playwright = await import("playwright");
  return playwright.chromium;
}

export async function openXiaohongshuLoginSession(config: AppConfig): Promise<void> {
  await withPersistentXiaohongshuContext(
    config,
    async (context) => {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto("https://www.xiaohongshu.com/explore", {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      console.log("Xiaohongshu login window is open.");
      console.log("Log in in the browser, then return here and press Ctrl+C.");

      await new Promise<void>((resolve) => {
        const cleanup = () => {
          process.off("SIGINT", onSigint);
          process.off("SIGTERM", onSigterm);
          resolve();
        };
        const onSigint = () => cleanup();
        const onSigterm = () => cleanup();
        process.on("SIGINT", onSigint);
        process.on("SIGTERM", onSigterm);
      });
    },
    { headless: false }
  );
}

export async function searchXiaohongshuNotes(
  context: BrowserContext,
  query: string,
  maxResults: number
): Promise<XiaohongshuSearchResult[]> {
  const directPage = await context.newPage();

  try {
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_explore_feed`;
    const directAttempt = await collectSearchAttempt(directPage, query, maxResults, {
      phasePrefix: "direct",
      navigate: async () => {
        await directPage.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await directPage.waitForTimeout(SEARCH_WAIT_MS);
      }
    });

    if (directAttempt.results.length > 0 || directAttempt.diagnosis.kind === "real_zero") {
      return directAttempt.results.slice(0, maxResults);
    }

    console.error(`[xhs-rent-watch] search fallback: ${query} -> interactive search after ${directAttempt.diagnosis.kind}`);
    const interactivePage = await context.newPage();
    try {
      const interactiveAttempt = await collectSearchAttempt(interactivePage, query, maxResults, {
        phasePrefix: "interactive",
        navigate: async () => {
          await openInteractiveSearch(interactivePage, query);
        }
      });

      if (interactiveAttempt.results.length === 0 && interactiveAttempt.diagnosis.kind !== "real_zero") {
        throw new Error(
          `${interactiveAttempt.diagnosis.message} (direct=${directAttempt.diagnosis.kind}, interactive=${interactiveAttempt.diagnosis.kind})`
        );
      }

      return interactiveAttempt.results.slice(0, maxResults);
    } finally {
      await interactivePage.close();
    }
  } finally {
    await directPage.close();
  }
}

export async function loadXiaohongshuNote(
  context: BrowserContext,
  result: XiaohongshuSearchResult
): Promise<Omit<HousingCandidateForAdjudication, "searchQueries" | "ruleEvaluation" | "visionSignals"> & {
  rawPayload: Record<string, unknown>;
}> {
  const page = await context.newPage();

  try {
    await page.goto(result.noteUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(NOTE_WAIT_MS);
    await waitWithRandomDelay(page, `before note capture ${result.noteId}`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);

    const state = await getStablePageContent(page);
    const detailFromState = extractNoteDetailFromState(state, result.noteId, result.noteUrl);
    const detailFromDom = await extractNoteDetailFromDom(page, result.noteId, result.noteUrl, result.title);
    const detail = mergeNoteDetails(detailFromState, detailFromDom, result);
    const screenshotDataUrl = await captureScreenshotDataUrl(page);

    return {
      noteId: detail.noteId,
      noteUrl: detail.noteUrl,
      title: detail.title,
      bodyText: detail.bodyText,
      locationText: detail.locationText,
      postedAt: detail.postedAt,
      authorName: detail.authorName,
      imageUrls: detail.imageUrls,
      screenshotDataUrl,
      pageText: detail.pageText,
      rawPayload: detail.rawPayload
    };
  } finally {
    await page.close();
  }
}

function mergeSearchResults(left: XiaohongshuSearchResult[], right: XiaohongshuSearchResult[]): XiaohongshuSearchResult[] {
  const merged = new Map<string, XiaohongshuSearchResult>();
  for (const item of [...left, ...right]) {
    const existing = merged.get(item.noteId);
    if (!existing) {
      merged.set(item.noteId, item);
      continue;
    }

    merged.set(item.noteId, {
      ...existing,
      title: existing.title.length >= item.title.length ? existing.title : item.title,
      authorName: existing.authorName ?? item.authorName,
      coverImageUrl: existing.coverImageUrl ?? item.coverImageUrl,
      rawPayload: {
        ...existing.rawPayload,
        ...item.rawPayload
      }
    });
  }
  return [...merged.values()];
}

async function collectSearchAttempt(
  page: Page,
  query: string,
  maxResults: number,
  input: {
    phasePrefix: string;
    navigate: () => Promise<void>;
  }
): Promise<SearchAttemptResult> {
  await input.navigate();

  let snapshot = await collectSearchResults(page, query);
  const snapshots: SearchCollectionSnapshot[] = [snapshot];
  let results = snapshot.results;
  logSearchSnapshot(query, `${input.phasePrefix}-initial`, snapshot);
  for (let step = 0; step < 2 && results.length < maxResults; step += 1) {
    await waitWithRandomDelay(page, `${query} ${input.phasePrefix} before scroll ${step + 1}`, SCROLL_DELAY_MIN_MS, SCROLL_DELAY_MAX_MS);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1_200);
    snapshot = await collectSearchResults(page, query);
    snapshots.push(snapshot);
    logSearchSnapshot(query, `${input.phasePrefix}-scroll-${step + 1}`, snapshot);
    results = mergeSearchResults(results, snapshot.results);
  }

  const diagnosis = diagnoseSearchResults(results, snapshots);
  logSearchDiagnosis(`${query} ${input.phasePrefix}`, diagnosis);

  return {
    results,
    snapshots,
    diagnosis
  };
}

async function openInteractiveSearch(page: Page, query: string): Promise<void> {
  console.error(`[xhs-rent-watch] interactive search open: ${query}`);
  await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(SEARCH_WAIT_MS);
  await dismissTransientOverlays(page);
  const pageTitle = await page.title().catch(() => "");
  const currentUrl = page.url();
  console.error(`[xhs-rent-watch] interactive search page: ${query} | title="${pageTitle}" | url=${currentUrl}`);
  if (/website-login\/captcha|Security Verification|安全验证|验证码/i.test(`${pageTitle} ${currentUrl}`)) {
    throw new Error("Xiaohongshu interactive search hit a captcha/security verification page");
  }

  const input = await resolveInteractiveSearchInput(page);
  await waitWithRandomDelay(page, `${query} before search input click`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
  await input.click({ timeout: 10_000, force: true });
  await waitWithRandomDelay(page, `${query} before clearing search input`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
  await input.fill("", { timeout: 10_000 });
  await waitWithRandomDelay(page, `${query} before typing search text`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
  await input.fill(query, { timeout: 10_000 });
  await waitWithRandomDelay(page, `${query} before pressing Enter`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);

  await Promise.allSettled([
    page.waitForURL(/search_result|search\?keyword|keyword=/i, { timeout: 12_000 }),
    input.press("Enter")
  ]);

  if (!/search_result|search\?keyword|keyword=/i.test(page.url())) {
    const button = page.locator("button.min-width-search-icon, button:has(.search-icon)").first();
    try {
      if (await button.isVisible({ timeout: 1_000 })) {
        await waitWithRandomDelay(page, `${query} before clicking search button`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
        await Promise.allSettled([
          page.waitForURL(/search_result|search\?keyword|keyword=/i, { timeout: 8_000 }),
          button.click({ timeout: 3_000 })
        ]);
      }
    } catch {
      // ignore button fallback misses
    }
  }

  await page.waitForTimeout(SEARCH_WAIT_MS);
  await dismissTransientOverlays(page);
  console.error(`[xhs-rent-watch] interactive search ready: ${query} | url=${page.url()}`);
}

async function resolveInteractiveSearchInput(page: Page) {
  const visibleInput = page.locator("input.search-input:visible").first();
  if ((await visibleInput.count()) > 0) {
    return visibleInput;
  }

  const namedInput = page.locator("input[name='hp-inputsearch-input']").last();
  if ((await namedInput.count()) > 0) {
    return namedInput;
  }

  const genericInput = page.locator("input.search-input").last();
  await genericInput.waitFor({ state: "attached", timeout: 10_000 });
  return genericInput;
}

async function dismissTransientOverlays(page: Page): Promise<void> {
  const selectors = [
    "button:has-text('我知道了')",
    "button:has-text('知道了')",
    "button:has-text('同意并继续')",
    "button:has-text('同意')"
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 500 })) {
        await waitWithRandomDelay(page, `before dismissing overlay ${selector}`, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS);
        await locator.click({ timeout: 1_500 });
        await page.waitForTimeout(250);
      }
    } catch {
      // ignore overlay dismissal misses
    }
  }
}

async function collectSearchResults(page: Page, query: string): Promise<SearchCollectionSnapshot> {
  const state = await getStablePageContent(page);
  const fromState = extractSearchResultsFromState(state, query);
  const fromDom = await extractSearchResultsFromDom(page, query);
  const bodyText = collapseWhitespace((await page.textContent("body").catch(() => "")) ?? "");

  return {
    results: mergeSearchResults(fromState.results, fromDom.results),
    stateResultCount: fromState.results.length,
    domResultCount: fromDom.results.length,
    domAnchorCount: fromDom.anchorCount,
    hasInitialState: fromState.hasInitialState,
    pageTitle: await page.title(),
    currentUrl: page.url(),
    bodyLength: bodyText.length,
    bodySnippet: truncateForDebug(bodyText, 220),
    loginPromptDetected: /登录|扫码|sign in|log in/i.test(bodyText),
    riskPromptDetected: /风险|300012|可靠网络环境/i.test(bodyText)
  };
}

function extractSearchResultsFromState(
  stateHtml: string,
  query: string
): { results: XiaohongshuSearchResult[]; hasInitialState: boolean } {
  const state = parseInitialStateFromHtml(stateHtml);
  const results = new Map<string, XiaohongshuSearchResult>();

  visitUnknownTree(state, (node) => {
    const noteId = pickNoteId(node);
    const title = pickString(node, ["title", "displayTitle", "noteTitle", "shareTitle"]);
    if (!noteId || !title || title.length < 2) {
      return;
    }

    const item: XiaohongshuSearchResult = {
      noteId,
      noteUrl: buildNoteUrl(noteId),
      title: collapseWhitespace(title),
      authorName: pickString(node, ["author.nickname", "user.nickname", "user.nickName", "displayUser.nickname"]) ?? undefined,
      coverImageUrl: firstImageUrl(node),
      query,
      rawPayload: simplifySearchNode(node)
    };

    if (!results.has(noteId)) {
      results.set(noteId, item);
    }
  });

  return {
    results: [...results.values()],
    hasInitialState: state != null
  };
}

async function extractSearchResultsFromDom(
  page: Page,
  query: string
): Promise<{ results: XiaohongshuSearchResult[]; anchorCount: number }> {
  const domResults = await page
    .$$eval("a[href*='/explore/']", (anchors) => {
      const extracted: Array<{
        href: string;
        title: string;
        authorName?: string;
        coverImageUrl?: string;
      }> = [];

      for (const anchor of anchors) {
        const href = anchor.getAttribute("href") ?? "";
        if (!/\/explore\//.test(href)) {
          continue;
        }
        const title = (anchor.textContent ?? "").trim();
        const image = anchor.querySelector("img")?.getAttribute("src") ?? undefined;
        extracted.push({
          href,
          title,
          authorName: undefined,
          coverImageUrl: image
        });
      }

      return {
        anchorCount: anchors.length,
        extracted
      };
    })
    .catch(() => ({
      anchorCount: 0,
      extracted: []
    }));

  const extracted: XiaohongshuSearchResult[] = [];
  for (const item of domResults.extracted) {
    const noteId = extractNoteIdFromUrl(item.href);
    if (!noteId || !item.title) {
      continue;
    }
    extracted.push({
      noteId,
      noteUrl: buildAbsoluteUrl(item.href),
      title: collapseWhitespace(item.title),
      authorName: item.authorName,
      coverImageUrl: item.coverImageUrl,
      query,
      rawPayload: {
        href: item.href
      }
    });
  }

  return {
    results: extracted,
    anchorCount: domResults.anchorCount
  };
}

function extractNoteDetailFromState(stateHtml: string, noteId: string, noteUrl: string): XiaohongshuNoteDetail | null {
  const state = parseInitialStateFromHtml(stateHtml);
  let bestScore = -1;
  let bestDetail: XiaohongshuNoteDetail | null = null;

  visitUnknownTree(state, (node) => {
    const candidateNoteId = pickNoteId(node) ?? noteId;
    if (candidateNoteId !== noteId) {
      return;
    }

    const title = pickString(node, ["title", "displayTitle", "noteTitle", "shareTitle"]);
    const bodyText = pickString(node, ["desc", "content", "description", "noteContent"]);
    const imageUrls = collectImageUrls(node);
    const score = [title, bodyText, imageUrls.length > 0 ? "image" : ""].filter(Boolean).length;

    if (score === 0) {
      return;
    }

    const detail: XiaohongshuNoteDetail = {
      noteId,
      noteUrl,
      title: collapseWhitespace(title ?? ""),
      bodyText: collapseWhitespace(bodyText ?? ""),
      authorName: pickString(node, ["author.nickname", "user.nickname", "user.nickName", "displayUser.nickname"]) ?? undefined,
      postedAt: pickDateString(node),
      locationText: pickString(node, ["ipLocation", "location", "poi.name", "tagList.0.name"]),
      city: inferCity(node),
      neighborhood: inferNeighborhood(node),
      imageUrls,
      pageText: collapseWhitespace([title ?? "", bodyText ?? "", pickString(node, ["ipLocation", "poi.name"]) ?? ""].join("\n")),
      rawPayload: simplifySearchNode(node)
    };

    if (score > bestScore) {
      bestScore = score;
      bestDetail = detail;
    }
  });

  return bestDetail;
}

async function extractNoteDetailFromDom(
  page: Page,
  noteId: string,
  noteUrl: string,
  fallbackTitle: string
): Promise<XiaohongshuNoteDetail> {
  const titleCandidates = await Promise.all([
    textFromSelector(page, "h1"),
    page.title().catch(() => "")
  ]);
  const bodyCandidates = await Promise.all([
    textFromSelector(page, "article"),
    textFromSelector(page, "main"),
    textFromSelector(page, "[class*='desc']"),
    textFromSelector(page, "[class*='content']")
  ]);

  const pageText = collapseWhitespace((await page.textContent("body")) ?? "");
  const bodyText = bodyCandidates
    .map((value) => collapseWhitespace(value))
    .filter((value) => value.length > 20)
    .sort((left, right) => right.length - left.length)[0];

  return {
    noteId,
    noteUrl,
    title: collapseWhitespace(titleCandidates.find((value) => value.trim().length > 0) ?? fallbackTitle),
    bodyText: collapseWhitespace(bodyText ?? ""),
    authorName: undefined,
    postedAt: null,
    locationText: null,
    city: /san francisco|旧金山/i.test(pageText) ? "San Francisco" : null,
    neighborhood: null,
    imageUrls: uniqueStrings(
      (
        await page.$$eval("img[src]", (images) =>
          images
            .map((image) => image.getAttribute("src") ?? "")
            .filter((src) => src.includes("xhscdn.com") || src.includes("xiaohongshu.com"))
        )
      ).slice(0, MAX_IMAGE_URLS)
    ),
    pageText,
    rawPayload: {}
  };
}

async function captureScreenshotDataUrl(page: Page): Promise<string | null> {
  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 60,
      fullPage: false
    });
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function textFromSelector(page: Page, selector: string): Promise<string> {
  try {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      return "";
    }
    return (await locator.textContent()) ?? "";
  } catch {
    return "";
  }
}

function mergeNoteDetails(
  stateDetail: XiaohongshuNoteDetail | null,
  domDetail: XiaohongshuNoteDetail,
  searchResult: XiaohongshuSearchResult
): XiaohongshuNoteDetail {
  const title = stateDetail?.title || domDetail.title || searchResult.title;
  const bodyText = stateDetail?.bodyText || domDetail.bodyText;
  const imageUrls = uniqueStrings([...(stateDetail?.imageUrls ?? []), ...domDetail.imageUrls]).slice(0, MAX_IMAGE_URLS);

  return {
    noteId: searchResult.noteId,
    noteUrl: searchResult.noteUrl,
    title: collapseWhitespace(title),
    bodyText: collapseWhitespace(bodyText),
    authorName: stateDetail?.authorName ?? domDetail.authorName ?? searchResult.authorName,
    postedAt: stateDetail?.postedAt ?? domDetail.postedAt ?? null,
    locationText: stateDetail?.locationText ?? domDetail.locationText ?? null,
    city: stateDetail?.city ?? domDetail.city ?? null,
    neighborhood: stateDetail?.neighborhood ?? domDetail.neighborhood ?? null,
    imageUrls,
    pageText: collapseWhitespace([stateDetail?.pageText ?? "", domDetail.pageText].join("\n")),
    rawPayload: {
      search: searchResult.rawPayload,
      detail: stateDetail?.rawPayload ?? {}
    }
  };
}

function visitUnknownTree(value: unknown, visitor: (node: Record<string, unknown>) => void): void {
  const seen = new Set<unknown>();

  const walk = (current: unknown, depth: number): void => {
    if (!current || typeof current !== "object" || seen.has(current) || depth > 12) {
      return;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        walk(item, depth + 1);
      }
      return;
    }

    const record = current as Record<string, unknown>;
    visitor(record);
    for (const next of Object.values(record)) {
      walk(next, depth + 1);
    }
  };

  walk(value, 0);
}

function pickNoteId(node: Record<string, unknown>): string | null {
  const direct = pickString(node, ["noteId", "id", "noteID", "note_id"]);
  if (direct && /^[A-Za-z0-9]{8,}$/.test(direct)) {
    return direct;
  }

  const url = pickString(node, ["noteUrl", "url", "link"]);
  return url ? extractNoteIdFromUrl(url) : null;
}

function extractNoteIdFromUrl(url: string): string | null {
  const match = url.match(/\/explore\/([A-Za-z0-9]+)/);
  return match?.[1] ?? null;
}

function pickString(node: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, node);

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function pickDateString(node: Record<string, unknown>): string | null {
  const value = pickString(node, ["publishTime", "publishDate", "time", "lastUpdateTime"]);
  if (!value) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value;
  }
  return value;
}

function inferCity(node: Record<string, unknown>): string | null {
  const location = `${pickString(node, ["ipLocation", "location", "poi.name"]) ?? ""}`.toLowerCase();
  if (/san francisco|旧金山/.test(location)) {
    return "San Francisco";
  }
  return null;
}

function inferNeighborhood(node: Record<string, unknown>): string | null {
  const location = `${pickString(node, ["ipLocation", "location", "poi.name"]) ?? ""}`.toLowerCase();
  const neighborhoods = [
    "mission bay",
    "dogpatch",
    "potrero hill",
    "soma",
    "south beach",
    "mission",
    "hayes valley",
    "castro",
    "bernal heights",
    "inner richmond",
    "inner sunset",
    "west portal",
    "glen park",
    "nob hill",
    "north beach",
    "chinatown",
    "pacific heights",
    "marina",
    "cow hollow",
    "bayview"
  ];

  return neighborhoods.find((item) => location.includes(item)) ?? null;
}

function firstImageUrl(node: Record<string, unknown>): string | undefined {
  return collectImageUrls(node)[0];
}

function collectImageUrls(node: Record<string, unknown>): string[] {
  const urls: string[] = [];

  visitUnknownTree(node, (child) => {
    for (const value of Object.values(child)) {
      if (typeof value === "string" && /https?:\/\/.*(xhscdn\.com|xiaohongshu\.com)/.test(value)) {
        urls.push(value);
      }
    }
  });

  return uniqueStrings(urls).slice(0, MAX_IMAGE_URLS);
}

function simplifySearchNode(node: Record<string, unknown>): Record<string, unknown> {
  return {
    noteId: pickNoteId(node),
    title: pickString(node, ["title", "displayTitle", "noteTitle", "shareTitle"]),
    authorName: pickString(node, ["author.nickname", "user.nickname", "user.nickName"]),
    locationText: pickString(node, ["ipLocation", "location", "poi.name"]),
    imageUrls: collectImageUrls(node)
  };
}

function buildNoteUrl(noteId: string): string {
  return `https://www.xiaohongshu.com/explore/${noteId}`;
}

function buildAbsoluteUrl(url: string): string {
  if (url.startsWith("http")) {
    return url;
  }
  return `https://www.xiaohongshu.com${url.startsWith("/") ? url : `/${url}`}`;
}

function logSearchSnapshot(query: string, phase: string, snapshot: SearchCollectionSnapshot): void {
  console.error(
    [
      `[xhs-rent-watch] search snapshot: ${query} ${phase}`,
      `title="${snapshot.pageTitle}"`,
      `url=${snapshot.currentUrl}`,
      `hasState=${snapshot.hasInitialState}`,
      `stateResults=${snapshot.stateResultCount}`,
      `domAnchors=${snapshot.domAnchorCount}`,
      `domResults=${snapshot.domResultCount}`,
      `merged=${snapshot.results.length}`,
      `bodyLength=${snapshot.bodyLength}`,
      `loginPrompt=${snapshot.loginPromptDetected}`,
      `riskPrompt=${snapshot.riskPromptDetected}`,
      snapshot.bodySnippet ? `bodySnippet="${snapshot.bodySnippet}"` : null
    ]
      .filter((value): value is string => Boolean(value))
      .join(" | ")
  );
}

function logSearchDiagnosis(query: string, diagnosis: SearchDiagnosis): void {
  console.error(
    [
      `[xhs-rent-watch] search diagnosis: ${query}`,
      `kind=${diagnosis.kind}`,
      `readableSurface=${diagnosis.readableSurfaceDetected}`,
      `message="${diagnosis.message}"`
    ].join(" | ")
  );
}

async function waitWithRandomDelay(page: Page, label: string, minMs: number, maxMs: number): Promise<number> {
  const delayMs = randomInt(minMs, maxMs + 1);
  console.error(`[xhs-rent-watch] wait: ${label} | ${delayMs}ms`);
  await page.waitForTimeout(delayMs);
  return delayMs;
}

function diagnoseSearchResults(results: XiaohongshuSearchResult[], snapshots: SearchCollectionSnapshot[]): SearchDiagnosis {
  const hasReadableSurface = snapshots.some(
    (snapshot) => snapshot.hasInitialState || snapshot.domAnchorCount > 0 || snapshot.domResultCount > 0
  );
  const loginGateDetected = snapshots.some((snapshot) => snapshot.loginPromptDetected);
  const riskBlockedDetected = snapshots.some((snapshot) => snapshot.riskPromptDetected);

  if (results.length > 0) {
    return {
      kind: "results_found",
      readableSurfaceDetected: hasReadableSurface,
      message: `Xiaohongshu search returned ${results.length} readable result(s)`
    };
  }

  if (riskBlockedDetected) {
    return {
      kind: "risk_blocked",
      readableSurfaceDetected: hasReadableSurface,
      message: "Xiaohongshu search was blocked by the 300012 risk page; try a different network or fresh session"
    };
  }

  if (loginGateDetected) {
    return {
      kind: "login_gate",
      readableSurfaceDetected: hasReadableSurface,
      message: "Xiaohongshu search is serving a login gate instead of result cards; re-open a fresh logged-in session"
    };
  }

  if (!hasReadableSurface) {
    return {
      kind: "dom_unreadable",
      readableSurfaceDetected: false,
      message: "Xiaohongshu search returned no readable initial state or result anchors; DOM may have changed"
    };
  }

  return {
    kind: "real_zero",
    readableSurfaceDetected: true,
    message: "Xiaohongshu search surface was readable but returned 0 matching result cards"
  };
}

function parseInitialStateFromHtml(html: string): unknown {
  const marker = "window.__INITIAL_STATE__=";
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const start = markerIndex + marker.length;
  const end = html.indexOf("</script>", start);
  if (end === -1) {
    return null;
  }

  const jsonText = html.slice(start, end).trim().replace(/;$/, "");
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function truncateForDebug(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trimEnd()}…`;
}

async function getStablePageContent(page: Page, attempts = 4): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      return await page.content();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/page\.content: Unable to retrieve content because the page is navigating/i.test(message)) {
        throw error;
      }
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
