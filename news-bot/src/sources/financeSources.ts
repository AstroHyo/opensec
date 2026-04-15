import { load } from "cheerio";
import Parser from "rss-parser";
import type { AppConfig } from "../config.js";
import type { SourceId, SourceItemInput } from "../types.js";
import { fetchJson, fetchText } from "../util/http.js";
import { collapseWhitespace, uniqueStrings } from "../util/text.js";

const parser = new Parser();
const SEC_BASE = "https://www.sec.gov";
const SEC_SUBMISSIONS_BASE = "https://data.sec.gov";
const BLS_BASE = "https://www.bls.gov";
const TREASURY_BASE = "https://home.treasury.gov";

type SecSubmissionsPayload = {
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
    };
  };
};

export async function fetchFederalReserveItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  return fetchOfficialRssItems({
    config,
    fetchedAt,
    url: config.sourceUrls.fedPressRss,
    sourceId: "fed_press",
    sourceType: "macro_official",
    sourceLabel: "Federal Reserve / Press Release",
    sourceAuthority: 100,
    keywords: ["fed", "rates", "macro"]
  });
}

export async function fetchSecPressItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  return fetchOfficialRssItems({
    config,
    fetchedAt,
    url: config.sourceUrls.secPressRss,
    sourceId: "sec_press",
    sourceType: "regulatory_official",
    sourceLabel: "SEC / Press Release",
    sourceAuthority: 94,
    keywords: ["sec", "regulation", "markets"]
  });
}

export async function fetchTreasuryPressItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const html = await fetchText(config.sourceUrls.treasuryPressPage, config.httpTimeoutMs);
  return parseTreasuryPressPage(html, config.sourceUrls.treasuryPressPage, fetchedAt);
}

export async function fetchBlsReleaseItems(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const items: SourceItemInput[] = [];

  for (const page of config.sourceUrls.blsReleasePages) {
    const parsed = await fetchSingleBlsReleaseItem(config, fetchedAt, page.key);
    if (parsed) {
      items.push(parsed);
    }
  }

  return items;
}

export async function fetchSingleBlsReleaseItem(
  config: AppConfig,
  fetchedAt: string,
  sourceId: "bls_cpi" | "bls_jobs" | "bls_ppi" | "bls_eci"
): Promise<SourceItemInput | null> {
  const page = config.sourceUrls.blsReleasePages.find((candidate) => candidate.key === sourceId);
  if (!page) {
    return null;
  }

  const html = await fetchText(page.url, config.httpTimeoutMs);
  return parseBlsReleasePage(html, page.key, page.label, page.url, fetchedAt);
}

export async function fetchMajorCompanyFilings(config: AppConfig, fetchedAt: string): Promise<SourceItemInput[]> {
  const items: SourceItemInput[] = [];

  for (const company of config.financeCompanies) {
    const data = await fetchJson<SecSubmissionsPayload>(
      `${SEC_SUBMISSIONS_BASE}/submissions/CIK${company.cik}.json`,
      config.httpTimeoutMs
    ).catch(() => null);

    const recent = data?.filings?.recent;
    if (!recent) {
      continue;
    }

    const forms = recent.form ?? [];
    const filingDates = recent.filingDate ?? [];
    const accessions = recent.accessionNumber ?? [];
    const documents = recent.primaryDocument ?? [];

    for (let index = 0; index < forms.length; index += 1) {
      const form = forms[index];
      if (!isTrackedCompanyForm(form)) {
        continue;
      }

      const accession = accessions[index];
      const document = documents[index];
      const filingDate = filingDates[index];
      if (!accession || !document || !filingDate) {
        continue;
      }

      const accessionPath = accession.replace(/-/g, "");
      const filingUrl = `${SEC_BASE}/Archives/edgar/data/${Number.parseInt(company.cik, 10)}/${accessionPath}/${document}`;

      items.push({
        sourceId: "major_company_filings",
        sourceType: "company_filing",
        sourceLayer: "primary",
        sourceLabel: `SEC Filings / ${company.name}`,
        sourceAuthority: 88,
        externalId: `${company.ticker}:${accession}`,
        title: `${company.name} ${form} filing`,
        description: buildCompanyFilingDescription(company.name, form),
        contentText: buildCompanyFilingDescription(company.name, form),
        sourceUrl: filingUrl,
        canonicalUrl: filingUrl,
        originalUrl: filingUrl,
        publishedAt: `${filingDate}T00:00:00Z`,
        fetchedAt,
        itemKind: "company",
        keywords: uniqueStrings([company.name, company.ticker, form, "filing", "company"]),
        metadata: {
          ...buildFinanceMetadata("major_company_filings", `${company.name} ${form} filing`, buildCompanyFilingDescription(company.name, form)),
          companyName: company.name,
          companyTicker: company.ticker,
          filingForm: form,
          cik: company.cik
        },
        rawPayload: {
          accession,
          primaryDocument: document,
          filingDate,
          form
        }
      });
    }
  }

  return items.slice(0, 40);
}

async function fetchOfficialRssItems(input: {
  config: AppConfig;
  fetchedAt: string;
  url: string;
  sourceId: SourceId;
  sourceType: SourceItemInput["sourceType"];
  sourceLabel: string;
  sourceAuthority: number;
  keywords: string[];
}): Promise<SourceItemInput[]> {
  const xml = await fetchText(input.url, input.config.httpTimeoutMs, {
    accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8"
  });
  const feed = await parser.parseString(xml);

  return (feed.items ?? []).slice(0, 30).flatMap((entry) => {
    const link = entry.link ?? entry.id;
    if (!link) {
      return [];
    }

    const title = collapseWhitespace(entry.title ?? "Untitled finance item");
    const description = collapseWhitespace(entry.contentSnippet ?? entry.content ?? title);
    return [
      {
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        sourceLayer: "primary",
        sourceLabel: input.sourceLabel,
        sourceAuthority: input.sourceAuthority,
        externalId: link,
        title,
        description,
        contentText: description,
        sourceUrl: link,
        canonicalUrl: link,
        originalUrl: link,
        publishedAt: entry.isoDate ?? entry.pubDate ?? input.fetchedAt,
        fetchedAt: input.fetchedAt,
        itemKind: "news",
        keywords: buildFinanceKeywords(`${title} ${description}`, input.keywords),
        metadata: {
          ...buildFinanceMetadata(input.sourceId, title, description)
        },
        rawPayload: {
          title: entry.title,
          description: entry.contentSnippet ?? entry.content ?? "",
          link
        }
      } satisfies SourceItemInput
    ];
  });
}

export function parseTreasuryPressPage(html: string, pageUrl: string, fetchedAt: string): SourceItemInput[] {
  const $ = load(html);
  const anchors = $("a[href]")
    .toArray()
    .reduce<SourceItemInput[]>((items, element) => {
      const anchor = $(element);
      const href = anchor.attr("href")?.trim();
      const title = collapseWhitespace(anchor.text());
      if (!href || !title || !/\/news\/press-releases\/[a-z0-9-]+$/i.test(href)) {
        return items;
      }

      const absoluteUrl = new URL(href, pageUrl).toString();
      const container = anchor.closest("article, li, .views-row, .node, .field__item");
      const containerText = collapseWhitespace(container.text());
      const publishedAt = parseFirstDate(containerText);
      const description = collapseWhitespace(containerText.replace(title, "").slice(0, 320)) || title;

      items.push({
        sourceId: "treasury_press",
        sourceType: "macro_official",
        sourceLayer: "primary",
        sourceLabel: "Treasury / Press Release",
        sourceAuthority: 92,
        externalId: absoluteUrl,
        title,
        description,
        contentText: description,
        sourceUrl: absoluteUrl,
        canonicalUrl: absoluteUrl,
        originalUrl: absoluteUrl,
        publishedAt: publishedAt ?? fetchedAt,
        fetchedAt,
        itemKind: "news",
        keywords: buildFinanceKeywords(`${title} ${description}`, ["treasury", "policy"]),
        metadata: {
          ...buildFinanceMetadata("treasury_press", title, description)
        },
        rawPayload: {
          pageUrl,
          title,
          href: absoluteUrl
        }
      });
      return items;
    }, []);

  return dedupeByExternalId(anchors).slice(0, 12);
}

export function parseBlsReleasePage(
  html: string,
  sourceId: "bls_cpi" | "bls_jobs" | "bls_ppi" | "bls_eci",
  sourceLabel: string,
  pageUrl: string,
  fetchedAt: string
): SourceItemInput | null {
  const $ = load(html);
  const links = $("a[href]")
    .toArray()
    .map((element) => {
      const anchor = $(element);
      const href = anchor.attr("href")?.trim();
      const title = collapseWhitespace(anchor.text());
      if (!href || href.endsWith(".toc.htm") || title.length < 20) {
        return null;
      }
      if (!href.includes("/news.release/")) {
        return null;
      }
      if (/^(HTML|PDF|RSS|Charts|Historical Data|News Release|read more »)$/i.test(title)) {
        return null;
      }
      return {
        title,
        url: new URL(href, BLS_BASE).toString(),
        containerText: collapseWhitespace(anchor.parent().text() || anchor.closest("p, li, div").text())
      };
    })
    .filter((value): value is { title: string; url: string; containerText: string } => Boolean(value));

  const first = links[0];
  if (!first) {
    return null;
  }

  const description = collapseWhitespace(first.containerText.replace(first.title, "").slice(0, 320)) || first.title;
  return {
    sourceId,
    sourceType: "macro_official",
    sourceLayer: "primary",
    sourceLabel,
    sourceAuthority: 96,
    externalId: first.url,
    title: first.title,
    description,
    contentText: description,
    sourceUrl: first.url,
    canonicalUrl: first.url,
    originalUrl: first.url,
    publishedAt: parseFirstDate(first.containerText) ?? fetchedAt,
    fetchedAt,
    itemKind: "news",
    keywords: buildFinanceKeywords(`${first.title} ${description}`, sourceIdToKeywords(sourceId)),
    metadata: {
      financeBucket: inferFinanceBucket(sourceId, first.title, description),
      listingPageUrl: pageUrl
    },
    rawPayload: {
      pageUrl,
      href: first.url,
      title: first.title
    }
  };
}

function sourceIdToKeywords(sourceId: "bls_cpi" | "bls_jobs" | "bls_ppi" | "bls_eci"): string[] {
  switch (sourceId) {
    case "bls_cpi":
      return ["cpi", "inflation", "prices"];
    case "bls_jobs":
      return ["jobs", "payroll", "unemployment"];
    case "bls_ppi":
      return ["ppi", "producer prices", "inflation"];
    case "bls_eci":
      return ["eci", "wages", "labor costs"];
  }
}

function inferFinanceBucket(sourceId: SourceId, title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();

  if (sourceId === "major_company_filings") {
    if (/\b(ai|gpu|gpus|data center|datacenter|capex|cloud|semiconductor|chips?|infrastructure)\b/.test(text)) {
      return "company_capital_ai";
    }
    return "company_filing";
  }
  if (sourceId === "sec_press") {
    if (/\b(enforcement|charged|charges|fraud|ponzi|insider|manipulation|settled|settlement)\b/.test(text)) {
      return "enforcement_low_impact";
    }
    return "regulation_market_structure";
  }
  if (sourceId === "bls_jobs" || /\bjobs?\b|\bpayroll\b|\bunemployment\b|\blabor\b/.test(text)) {
    return "labor";
  }
  if (sourceId === "bls_cpi" || sourceId === "bls_ppi" || /\bcpi\b|\bppi\b|\binflation\b|\bprices\b/.test(text)) {
    return "inflation";
  }
  if (sourceId === "fed_press") {
    if (/\bliquidity\b|\bfunding\b|\bdiscount window\b|\bfacility\b|\bswap\b|\bbank funding\b|\breserve\b/.test(text)) {
      return "liquidity_credit";
    }
    return "rates_policy";
  }
  if (sourceId === "treasury_press") {
    if (/\b(tax cuts?|working families|president trump|signature new tax cuts?|claimed at least one)\b/.test(text)) {
      return "political_or_promotional";
    }
    if (/\b(sanction|sanctions|ofac|cartel|money laundering|smuggling|casino|casinos)\b/.test(text)) {
      if (/\b(energy|oil|shipping|trade|port|tariff|export|import|commodity|commodities|supply chain|semiconductor|chips?)\b/.test(text)) {
        return "trade_sanctions_macro";
      }
      return "enforcement_low_impact";
    }
    if (/\bauction\b|\bborrowing\b|\bbuyback\b|\bdebt management\b|\bliquidity\b|\bfunding\b|\btreasury market\b|\byield\b/.test(text)) {
      return "liquidity_credit";
    }
    return "policy_other";
  }
  if (/\brate\b|\bfed\b|\byield\b|\bpolicy rate\b/.test(text)) {
    return "rates_policy";
  }
  return "policy_other";
}

function buildFinanceMetadata(sourceId: SourceId, title: string, description: string): Record<string, unknown> {
  const bucket = inferFinanceBucket(sourceId, title, description);
  const transmissionChannels = inferFinanceTransmissionChannels(bucket, title, description);
  const affectedAssets = inferFinanceAffectedAssets(bucket, title, description);
  const marketImpactLevel = inferFinanceMarketImpactLevel(bucket);

  return {
    financeBucket: bucket,
    marketImpactLevel,
    transmissionChannels,
    affectedAssets,
    financeExcludeFromBrief: bucket === "political_or_promotional" || bucket === "enforcement_low_impact"
  };
}

function inferFinanceTransmissionChannels(bucket: string, title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();

  if (bucket === "rates_policy") {
    return uniqueStrings(["rates", "fed path", "bank funding"]);
  }
  if (bucket === "inflation") {
    return uniqueStrings(["inflation expectations", "rates", "margin outlook"]);
  }
  if (bucket === "labor") {
    return uniqueStrings(["growth expectations", "fed path", "wage pressure"]);
  }
  if (bucket === "liquidity_credit") {
    return uniqueStrings(["liquidity", "funding", "credit conditions"]);
  }
  if (bucket === "regulation_market_structure") {
    return uniqueStrings(["market structure", "disclosure burden", "capital markets"]);
  }
  if (bucket === "trade_sanctions_macro") {
    return uniqueStrings(["trade flows", "commodities", "cross-border funding"]);
  }
  if (bucket === "company_capital_ai") {
    return uniqueStrings(["AI capex", "earnings expectations", "financing conditions"]);
  }
  if (bucket === "company_filing") {
    return uniqueStrings(["guidance", "risk factors", "capital allocation"]);
  }

  if (/\bdisclosure\b|\bissuer\b|\bexchange\b/.test(text)) {
    return uniqueStrings(["disclosure burden", "market structure"]);
  }

  return [];
}

function inferFinanceAffectedAssets(bucket: string, title: string, description: string): string[] {
  const text = `${title} ${description}`.toLowerCase();

  if (bucket === "rates_policy" || bucket === "inflation" || bucket === "labor") {
    return uniqueStrings(["UST", "USD", "rate-sensitive equities"]);
  }
  if (bucket === "liquidity_credit") {
    return uniqueStrings(["banks", "credit", "UST"]);
  }
  if (bucket === "regulation_market_structure") {
    return uniqueStrings(["brokers", "exchanges", "large-cap issuers"]);
  }
  if (bucket === "trade_sanctions_macro") {
    return uniqueStrings(["energy", "shipping", "EM FX"]);
  }
  if (bucket === "company_capital_ai") {
    return uniqueStrings(["semiconductors", "hyperscalers", "data center supply chain"]);
  }
  if (bucket === "company_filing") {
    return uniqueStrings(["single stock", "sector peers"]);
  }

  if (/\benergy\b|\boil\b/.test(text)) {
    return uniqueStrings(["energy", "inflation expectations"]);
  }

  return [];
}

function inferFinanceMarketImpactLevel(bucket: string): "high" | "medium" | "low" {
  if (bucket === "rates_policy" || bucket === "inflation" || bucket === "labor" || bucket === "liquidity_credit") {
    return "high";
  }
  if (bucket === "regulation_market_structure" || bucket === "trade_sanctions_macro" || bucket === "company_capital_ai" || bucket === "company_filing") {
    return "medium";
  }
  return "low";
}

function buildFinanceKeywords(text: string, defaults: string[]): string[] {
  const lower = text.toLowerCase();
  const keywords = [...defaults];
  const rules: Array<[RegExp, string]> = [
    [/\bfed\b|\bfederal reserve\b|\bfomc\b/, "fed"],
    [/\brate\b|\brates\b|\bpolicy rate\b/, "rates"],
    [/\bcpi\b|\binflation\b/, "inflation"],
    [/\bppi\b/, "ppi"],
    [/\bjobs?\b|\bpayroll\b|\bunemployment\b/, "jobs"],
    [/\beci\b|\bwage\b|\bwages\b/, "wages"],
    [/\bsec\b|\benforcement\b|\bdisclosure\b/, "sec"],
    [/\bfiling\b|\b10-k\b|\b10-q\b|\b8-k\b/, "filing"],
    [/\bguidance\b|\bbuyback\b|\bcapex\b|\bearnings\b/, "company signal"]
  ];

  for (const [pattern, label] of rules) {
    if (pattern.test(lower)) {
      keywords.push(label);
    }
  }

  return uniqueStrings(keywords);
}

function buildCompanyFilingDescription(companyName: string, form: string): string {
  if (form === "8-K") {
    return `${companyName}의 8-K 공시입니다. 중요한 이벤트, 가이던스, 자본 배분, 또는 경영진 발언을 확인해야 합니다.`;
  }
  if (form === "10-Q") {
    return `${companyName}의 10-Q 분기 공시입니다. 실적, 비용 구조, AI 투자, 리스크 요인을 확인할 수 있습니다.`;
  }
  if (form === "10-K") {
    return `${companyName}의 10-K 연간 공시입니다. 장기 전략, 리스크, 자본 배분, 핵심 사업 변화를 확인할 수 있습니다.`;
  }
  return `${companyName}의 ${form} 공식 공시입니다.`;
}

function isTrackedCompanyForm(form?: string): boolean {
  return form === "8-K" || form === "10-Q" || form === "10-K";
}

function parseFirstDate(text: string): string | null {
  const match = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) {
    return null;
  }

  return `${match[3]}-${match[1]}-${match[2]}T00:00:00Z`;
}

function dedupeByExternalId(items: SourceItemInput[]): SourceItemInput[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.externalId)) {
      return false;
    }
    seen.add(item.externalId);
    return true;
  });
}
