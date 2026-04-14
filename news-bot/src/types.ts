export type SourceId =
  | "geeknews"
  | "openai_news"
  | "github_trending"
  | "techmeme"
  | "hacker_news"
  | "bluesky_watch"
  | "fed_press"
  | "sec_press"
  | "treasury_press"
  | "bls_cpi"
  | "bls_jobs"
  | "bls_ppi"
  | "bls_eci"
  | "major_company_filings";

export type SourceLayer = "primary" | "precision" | "early_warning";

export type SourceType =
  | "openai_official"
  | "geeknews"
  | "github_trending"
  | "vendor_official"
  | "techmeme"
  | "hacker_news"
  | "social_signal"
  | "macro_official"
  | "regulatory_official"
  | "company_filing";

export type ProfileKey = "tech" | "finance";

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
  sourceLayer?: SourceLayer;
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
  sourceLayer: SourceLayer;
  sourceLabel: string;
  externalId: string;
  sourceUrl: string;
  originalUrl?: string | null;
  title: string;
  publishedAt?: string | null;
  fetchedAt: string;
  payload: unknown;
}

export interface SignalEventInput {
  sourceId: Extract<SourceId, "bluesky_watch">;
  sourceLayer?: Extract<SourceLayer, "early_warning">;
  actorLabel: string;
  actorHandle?: string;
  postUrl: string;
  linkedUrl?: string | null;
  title?: string;
  excerpt?: string;
  publishedAt?: string;
  fetchedAt: string;
  metrics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SignalEventRecord {
  id: number;
  sourceId: Extract<SourceId, "bluesky_watch">;
  sourceLayer: Extract<SourceLayer, "early_warning">;
  actorLabel: string;
  actorHandle?: string | null;
  postUrl: string;
  linkedUrl?: string | null;
  title?: string | null;
  excerpt?: string | null;
  publishedAt?: string | null;
  fetchedAt: string;
  metrics: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface SignalMatchRecord {
  id: number;
  signalEventId: number;
  itemId: number;
  matchType: "linked_url" | "title_similarity";
  boostScore: number;
  signal: SignalEventRecord;
}

export interface NormalizedItemRecord {
  id: number;
  canonicalUrl: string;
  title: string;
  normalizedTitle: string;
  titleHash: string;
  sourceType: SourceType;
  primarySourceLayer: SourceLayer;
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
  matchedSignals: SignalMatchRecord[];
}

export interface SourceRunSummary {
  profileKey: ProfileKey;
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
  precisionSignalScore: number;
  earlyWarningScore: number;
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
  profileKey: ProfileKey;
  number: number;
  itemId: number;
  sectionKey: string;
  sourceType: SourceType;
  itemKind: ItemKind;
  title: string;
  summary: string;
  whyImportant: string;
  whatChanged?: string;
  engineerRelevance?: string;
  aiEcosystem?: string;
  openAiAngle?: string | null;
  trendSignal?: string;
  causeEffect?: string;
  watchpoints?: string[];
  evidenceSpans?: string[];
  contentSnippet?: string | null;
  primaryUrl: string;
  sourceLabel: string;
  score: number;
  deterministicScore?: number;
  rerankDelta?: number;
  finalScore?: number;
  scoreReasons: string[];
  sourceLinks: Array<{ label: string; url: string }>;
  signalLinks?: Array<{ label: string; url: string }>;
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
  profileKey: ProfileKey;
  mode: DigestMode;
  header: string;
  window: DigestWindow;
  sections: DigestSection[];
  themes: string[];
  items: DigestEntry[];
  candidateEntries?: DigestEntry[];
  bodyText: string;
  stats: Record<string, unknown>;
}

export interface SavedDigestRecord {
  id: number;
  profileKey: ProfileKey;
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

export type LlmRunType = "item_enrichment" | "theme_synthesis" | "followup_answer" | "followup_research";
export type LlmProvider = "openai" | "xai";
export type LlmTaskTier = 0 | 1 | 2 | 3;
export type LlmTaskKey =
  | "item_enrichment"
  | "theme_synthesis_am"
  | "theme_synthesis_pm"
  | "followup_answer"
  | "followup_research";

export interface LlmRunRecord {
  id: number;
  profileKey: ProfileKey;
  runType: LlmRunType;
  taskKey?: LlmTaskKey | null;
  taskTier?: LlmTaskTier | null;
  provider?: LlmProvider | null;
  modelName: string;
  promptVersion: string;
  inputHash: string;
  startedAt: string;
  completedAt?: string | null;
  status: "running" | "ok" | "partial" | "error";
  latencyMs?: number | null;
  tokenUsage?: Record<string, unknown> | null;
  estimatedCostUsd?: number | null;
  errorText?: string | null;
}

export interface ItemEnrichmentRecord {
  id: number;
  profileKey: ProfileKey;
  itemId: number;
  llmRunId?: number | null;
  promptVersion: string;
  sourceHash: string;
  summaryKo: string;
  whyImportantKo: string;
  whatChangedKo?: string | null;
  engineerRelevanceKo?: string | null;
  aiEcosystemKo?: string | null;
  openAiAngleKo?: string | null;
  trendSignalKo?: string | null;
  causeEffectKo?: string | null;
  watchpoints: string[];
  evidenceSpans: string[];
  noveltyScore?: number | null;
  insightScore?: number | null;
  confidence: number;
  uncertaintyNotes: string[];
  themeTags: string[];
  officialnessNote?: string | null;
  createdAt: string;
}

export interface DigestThemeEnrichmentRecord {
  id: number;
  profileKey: ProfileKey;
  digestCacheKey: string;
  digestMode: DigestMode;
  llmRunId?: number | null;
  promptVersion: string;
  themes: string[];
  createdAt: string;
}

export interface ArticleContextRecord {
  id: number;
  itemId: number;
  sourceHash: string;
  canonicalUrl: string;
  fetchStatus: "ok" | "fallback" | "error";
  publisher?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  headline: string;
  dek?: string | null;
  cleanText: string;
  keySections: string[];
  evidenceSnippets: string[];
  wordCount: number;
  fetchedAt: string;
}

export interface BlueskyWatchActor {
  label: string;
  handle: string;
}
