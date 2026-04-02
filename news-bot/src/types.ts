export type SourceId = "geeknews" | "openai_news" | "github_trending";

export type SourceType =
  | "openai_official"
  | "geeknews"
  | "github_trending"
  | "vendor_official";

export type DigestMode = "am" | "pm" | "manual";

export type GeekNewsKind = "news" | "ask" | "show";

export type OpenAICategory =
  | "Product"
  | "Research"
  | "Engineering"
  | "Safety"
  | "Security"
  | "Company"
  | "External Coverage";

export type ItemKind =
  | "news"
  | "repo"
  | "product"
  | "research"
  | "engineering"
  | "safety"
  | "security"
  | "company"
  | "ask"
  | "show";

export interface SourceItemInput {
  sourceId: SourceId;
  sourceType: SourceType;
  sourceLabel: string;
  sourceAuthority: number;
  externalId: string;
  title: string;
  description?: string;
  contentText?: string;
  sourceUrl: string;
  canonicalUrl: string;
  originalUrl?: string;
  publishedAt?: string;
  fetchedAt: string;
  itemKind: ItemKind;
  openaiCategory?: OpenAICategory;
  geeknewsKind?: GeekNewsKind;
  repoOwner?: string;
  repoName?: string;
  repoLanguage?: string;
  repoStarsToday?: number;
  repoStarsTotal?: number;
  keywords?: string[];
  metadata?: Record<string, unknown>;
  rawPayload?: unknown;
}

export interface ItemSourceRecord {
  id: number;
  itemId: number;
  sourceId: SourceId;
  sourceType: SourceType;
  sourceLabel: string;
  externalId: string;
  sourceUrl: string;
  originalUrl?: string | null;
  title: string;
  publishedAt?: string | null;
  fetchedAt: string;
  payload: unknown;
}

export interface NormalizedItemRecord {
  id: number;
  canonicalUrl: string;
  title: string;
  normalizedTitle: string;
  titleHash: string;
  sourceType: SourceType;
  primarySourceId: SourceId;
  primarySourceLabel: string;
  sourceAuthority: number;
  sourceLabels: string[];
  publishedAt?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastUpdatedAt: string;
  itemKind: ItemKind;
  openaiCategory?: OpenAICategory | null;
  geeknewsKind?: GeekNewsKind | null;
  repoOwner?: string | null;
  repoName?: string | null;
  repoLanguage?: string | null;
  repoStarsToday?: number | null;
  repoStarsTotal?: number | null;
  description?: string | null;
  contentText?: string | null;
  sourceUrl: string;
  originalUrl?: string | null;
  metadata: Record<string, unknown>;
  keywords: string[];
  lastSentAt?: string | null;
  crossSignalCount: number;
  sources: ItemSourceRecord[];
}

export interface SourceRunSummary {
  sourceId: SourceId;
  itemsFetched: number;
  itemsNormalized: number;
  errors?: string[];
}

export interface ScoreBreakdown {
  total: number;
  suppressed: boolean;
  authorityScore: number;
  freshnessScore: number;
  keywordScore: number;
  methodologyScore: number;
  tractionScore: number;
  crossSignalScore: number;
  resendPenalty: number;
  matchedKeywords: string[];
  reasons: string[];
}

export interface DigestWindow {
  mode: DigestMode;
  startUtc: string;
  endUtc: string;
  dateLabel: string;
}

export interface DigestEntry {
  number: number;
  itemId: number;
  sectionKey: string;
  title: string;
  summary: string;
  whyImportant: string;
  contentSnippet?: string | null;
  primaryUrl: string;
  sourceLabel: string;
  score: number;
  scoreReasons: string[];
  sourceLinks: Array<{ label: string; url: string }>;
  openaiCategory?: OpenAICategory | null;
  repoLanguage?: string | null;
  repoStarsToday?: number | null;
  repoStarsTotal?: number | null;
  keywords: string[];
  description?: string | null;
  wasLlmEnriched?: boolean;
  enrichmentConfidence?: number | null;
  uncertaintyNotes?: string[];
  themeTags?: string[];
  officialnessNote?: string | null;
  metadata: Record<string, unknown>;
}

export interface DigestSection {
  key: string;
  title: string;
  items: DigestEntry[];
  bullets?: string[];
}

export interface DigestBuildResult {
  mode: DigestMode;
  header: string;
  window: DigestWindow;
  sections: DigestSection[];
  themes: string[];
  items: DigestEntry[];
  bodyText: string;
  stats: Record<string, unknown>;
}

export interface SavedDigestRecord {
  id: number;
  mode: DigestMode;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  header: string;
  bodyText: string;
  items: DigestEntry[];
  themes: string[];
  stats: Record<string, unknown>;
}

export type LlmRunType = "item_enrichment" | "theme_synthesis";

export interface LlmRunRecord {
  id: number;
  runType: LlmRunType;
  modelName: string;
  promptVersion: string;
  inputHash: string;
  startedAt: string;
  completedAt?: string | null;
  status: "running" | "ok" | "partial" | "error";
  latencyMs?: number | null;
  tokenUsage?: Record<string, unknown> | null;
  errorText?: string | null;
}

export interface ItemEnrichmentRecord {
  id: number;
  itemId: number;
  llmRunId?: number | null;
  promptVersion: string;
  sourceHash: string;
  summaryKo: string;
  whyImportantKo: string;
  confidence: number;
  uncertaintyNotes: string[];
  themeTags: string[];
  officialnessNote?: string | null;
  createdAt: string;
}

export interface DigestThemeEnrichmentRecord {
  id: number;
  digestCacheKey: string;
  digestMode: DigestMode;
  llmRunId?: number | null;
  promptVersion: string;
  themes: string[];
  createdAt: string;
}
