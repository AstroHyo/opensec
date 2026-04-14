import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { HousingCandidateRecord, HousingDecision, HousingNotificationRecord } from "./housing/types.js";
import { canonicalizeUrl, normalizeTitle, sha256Hex } from "./util/canonicalize.js";
import { titleSimilarity } from "./util/dedupe.js";
import { buildSuppressionFingerprintFromEntry, type RecentSentIdentity } from "./util/suppression.js";
import { collapseWhitespace, firstNonEmpty, uniqueStrings } from "./util/text.js";
import type {
  ArticleContextRecord,
  DigestBuildResult,
  DigestMode,
  DigestEntry,
  DigestThemeEnrichmentRecord,
  ItemEnrichmentRecord,
  SignalEventInput,
  SignalEventRecord,
  SignalMatchRecord,
  ItemSourceRecord,
  LlmProvider,
  LlmRunRecord,
  LlmTaskKey,
  LlmTaskTier,
  LlmRunType,
  NormalizedItemRecord,
  SavedDigestRecord,
  ProfileKey,
  SourceItemInput,
  SourceLayer,
  SourceRunSummary,
  SourceType
} from "./types.js";
import { inferSourceLayer } from "./sources/layers.js";

type BetterSqlite3Database = Database.Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS raw_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(source_id, external_id, content_hash)
);

CREATE TABLE IF NOT EXISTS normalized_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  title_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  primary_source_layer TEXT NOT NULL DEFAULT 'primary',
  primary_source_id TEXT NOT NULL,
  primary_source_label TEXT NOT NULL,
  source_authority INTEGER NOT NULL,
  source_labels_json TEXT NOT NULL,
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_updated_at TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  openai_category TEXT,
  geeknews_kind TEXT,
  repo_owner TEXT,
  repo_name TEXT,
  repo_language TEXT,
  repo_stars_today INTEGER,
  repo_stars_total INTEGER,
  description TEXT,
  content_text TEXT,
  source_url TEXT NOT NULL,
  original_url TEXT,
  metadata_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_layer TEXT NOT NULL DEFAULT 'primary',
  source_label TEXT NOT NULL,
  external_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  original_url TEXT,
  title TEXT NOT NULL,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(item_id, source_id, source_url)
);

CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_key TEXT NOT NULL DEFAULT 'tech',
  mode TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  header TEXT NOT NULL,
  body_text TEXT NOT NULL,
  items_json TEXT NOT NULL,
  themes_json TEXT NOT NULL,
  stats_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sent_items (
  profile_key TEXT NOT NULL DEFAULT 'tech',
  digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  send_reason TEXT,
  section_key TEXT,
  canonical_identity_hash TEXT,
  story_cluster_hash TEXT,
  title_snapshot TEXT,
  url_snapshot TEXT,
  suppression_basis_json TEXT NOT NULL DEFAULT '{}',
  override_reason TEXT,
  content_source_hash TEXT,
  last_updated_snapshot TEXT,
  PRIMARY KEY (digest_id, item_id)
);

CREATE TABLE IF NOT EXISTS followup_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_key TEXT NOT NULL DEFAULT 'tech',
  digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_number INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  context_json TEXT NOT NULL,
  UNIQUE(digest_id, item_number)
);

CREATE TABLE IF NOT EXISTS source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_key TEXT NOT NULL DEFAULT 'tech',
  source_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  items_fetched INTEGER DEFAULT 0,
  items_normalized INTEGER DEFAULT 0,
  error_text TEXT
);

CREATE TABLE IF NOT EXISTS llm_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_key TEXT NOT NULL DEFAULT 'tech',
  run_type TEXT NOT NULL,
  task_key TEXT,
  task_tier INTEGER,
  provider TEXT,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  token_usage_json TEXT,
  estimated_cost_usd REAL,
  error_text TEXT
);

CREATE TABLE IF NOT EXISTS item_enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_key TEXT NOT NULL DEFAULT 'tech',
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  llm_run_id INTEGER REFERENCES llm_runs(id) ON DELETE SET NULL,
  prompt_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  summary_ko TEXT NOT NULL,
  why_important_ko TEXT NOT NULL,
  confidence REAL NOT NULL,
  uncertainty_notes_json TEXT NOT NULL,
  theme_tags_json TEXT NOT NULL,
  officialness_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(item_id, prompt_version, source_hash)
);

CREATE TABLE IF NOT EXISTS digest_enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_key TEXT NOT NULL DEFAULT 'tech',
  digest_cache_key TEXT NOT NULL,
  digest_mode TEXT NOT NULL,
  llm_run_id INTEGER REFERENCES llm_runs(id) ON DELETE SET NULL,
  prompt_version TEXT NOT NULL,
  themes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(digest_cache_key, prompt_version)
);

CREATE TABLE IF NOT EXISTS article_contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  source_hash TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  fetch_status TEXT NOT NULL,
  publisher TEXT,
  author TEXT,
  published_at TEXT,
  headline TEXT NOT NULL,
  dek TEXT,
  clean_text TEXT NOT NULL,
  key_sections_json TEXT NOT NULL,
  evidence_snippets_json TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  UNIQUE(item_id, source_hash)
);

CREATE TABLE IF NOT EXISTS signal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_layer TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  actor_handle TEXT,
  post_url TEXT NOT NULL,
  linked_url TEXT,
  title TEXT,
  excerpt TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE(source_id, post_url)
);

CREATE TABLE IF NOT EXISTS signal_event_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_event_id INTEGER NOT NULL REFERENCES signal_events(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL,
  boost_score REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(signal_event_id, item_id)
);

CREATE TABLE IF NOT EXISTS housing_watch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  queries_json TEXT NOT NULL,
  harvested_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  notified_count INTEGER NOT NULL DEFAULT 0,
  error_text TEXT,
  stats_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS housing_watch_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id TEXT NOT NULL UNIQUE,
  note_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author_name TEXT,
  city TEXT,
  neighborhood TEXT,
  location_summary TEXT,
  location_text TEXT,
  posted_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_evaluated_at TEXT,
  search_queries_json TEXT NOT NULL,
  body_text TEXT NOT NULL,
  page_text TEXT NOT NULL,
  ocr_text TEXT,
  image_urls_json TEXT NOT NULL,
  screenshot_captured INTEGER NOT NULL DEFAULT 0,
  hard_filter_decision TEXT NOT NULL,
  hard_filter_reasons_json TEXT NOT NULL,
  llm_prompt_version TEXT,
  llm_model_name TEXT,
  llm_input_hash TEXT,
  llm_output_json TEXT,
  decision TEXT NOT NULL,
  decision_reasons_json TEXT NOT NULL,
  confidence REAL,
  unit_type TEXT NOT NULL DEFAULT 'unknown',
  whole_unit INTEGER,
  female_only INTEGER,
  shared_space INTEGER,
  roommate_only INTEGER,
  availability_summary TEXT,
  availability_start TEXT,
  availability_end TEXT,
  commute_friendly INTEGER,
  raw_payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS housing_watch_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER REFERENCES housing_watch_candidates(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  delivery_key TEXT NOT NULL UNIQUE,
  destination_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  message_text TEXT NOT NULL,
  error_text TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_normalized_items_title_hash ON normalized_items(title_hash);
CREATE INDEX IF NOT EXISTS idx_normalized_items_last_seen ON normalized_items(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_digests_profile_mode_generated ON digests(profile_key, mode, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_items_item_sent_at ON sent_items(profile_key, item_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_items_recent_identity ON sent_items(profile_key, sent_at DESC, canonical_identity_hash, story_cluster_hash);
CREATE INDEX IF NOT EXISTS idx_followup_context_digest_number ON followup_context(profile_key, digest_id, item_number);
CREATE INDEX IF NOT EXISTS idx_source_runs_profile_source_started ON source_runs(profile_key, source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_runs_profile_type_started ON llm_runs(profile_key, run_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_runs_profile_completed ON llm_runs(profile_key, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_enrichments_item_lookup ON item_enrichments(profile_key, item_id, prompt_version, source_hash);
CREATE INDEX IF NOT EXISTS idx_digest_enrichments_lookup ON digest_enrichments(profile_key, digest_cache_key, prompt_version);
CREATE INDEX IF NOT EXISTS idx_article_contexts_item_lookup ON article_contexts(item_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_signal_events_linked_url ON signal_events(linked_url);
CREATE INDEX IF NOT EXISTS idx_signal_events_fetched_at ON signal_events(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_event_matches_item ON signal_event_matches(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_housing_watch_candidates_decision ON housing_watch_candidates(decision, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_housing_watch_notifications_type_created ON housing_watch_notifications(notification_type, created_at DESC);
`;

export class NewsDatabase {
  private readonly db: BetterSqlite3Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.exec(SCHEMA);
    this.applyMigrations();
    this.applyIndexes();
  }

  close(): void {
    this.db.close();
  }

  private applyMigrations(): void {
    this.ensureColumn("normalized_items", "primary_source_layer", "TEXT NOT NULL DEFAULT 'primary'");
    this.ensureColumn("item_sources", "source_layer", "TEXT NOT NULL DEFAULT 'primary'");
    this.ensureColumn("digests", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("sent_items", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("sent_items", "section_key", "TEXT");
    this.ensureColumn("sent_items", "canonical_identity_hash", "TEXT");
    this.ensureColumn("sent_items", "story_cluster_hash", "TEXT");
    this.ensureColumn("sent_items", "title_snapshot", "TEXT");
    this.ensureColumn("sent_items", "url_snapshot", "TEXT");
    this.ensureColumn("sent_items", "suppression_basis_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("sent_items", "override_reason", "TEXT");
    this.ensureColumn("sent_items", "content_source_hash", "TEXT");
    this.ensureColumn("sent_items", "last_updated_snapshot", "TEXT");
    this.ensureColumn("followup_context", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("source_runs", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("llm_runs", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("llm_runs", "task_key", "TEXT");
    this.ensureColumn("llm_runs", "task_tier", "INTEGER");
    this.ensureColumn("llm_runs", "provider", "TEXT");
    this.ensureColumn("llm_runs", "estimated_cost_usd", "REAL");
    this.ensureColumn("item_enrichments", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("digest_enrichments", "profile_key", "TEXT NOT NULL DEFAULT 'tech'");
    this.ensureColumn("item_enrichments", "what_changed_ko", "TEXT");
    this.ensureColumn("item_enrichments", "engineer_relevance_ko", "TEXT");
    this.ensureColumn("item_enrichments", "ai_ecosystem_ko", "TEXT");
    this.ensureColumn("item_enrichments", "openai_angle_ko", "TEXT");
    this.ensureColumn("item_enrichments", "trend_signal_ko", "TEXT");
    this.ensureColumn("item_enrichments", "cause_effect_ko", "TEXT");
    this.ensureColumn("item_enrichments", "watchpoints_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("item_enrichments", "evidence_spans_json", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("item_enrichments", "novelty_score", "REAL");
    this.ensureColumn("item_enrichments", "insight_score", "REAL");
  }

  private applyIndexes(): void {
    this.db.exec(INDEXES);
  }

  private ensureColumn(tableName: string, columnName: string, columnSql: string): void {
    const columns = this.db
      .prepare<unknown[], { name: string }>(`PRAGMA table_info(${tableName})`)
      .all();

    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
    }
  }

  startSourceRun(sourceId: string, profileKey: ProfileKey, startedAt: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO source_runs (profile_key, source_id, started_at, status)
         VALUES (?, ?, ?, 'running')`
      )
      .run(profileKey, sourceId, startedAt);
    return Number(result.lastInsertRowid);
  }

  finishSourceRun(runId: number, summary: SourceRunSummary): void {
    this.db
      .prepare(
        `UPDATE source_runs
         SET completed_at = ?, status = ?, items_fetched = ?, items_normalized = ?, error_text = ?
         WHERE id = ?`
      )
      .run(
        new Date().toISOString(),
        summary.errors?.length ? "partial" : "ok",
        summary.itemsFetched,
        summary.itemsNormalized,
        summary.errors?.join("\n") ?? null,
        runId
      );
  }

  startHousingWatchRun(input: { startedAt: string; queries: string[] }): number {
    const result = this.db
      .prepare(
        `INSERT INTO housing_watch_runs (started_at, status, queries_json, stats_json)
         VALUES (?, 'running', ?, '{}')`
      )
      .run(input.startedAt, JSON.stringify(input.queries));
    return Number(result.lastInsertRowid);
  }

  finishHousingWatchRun(input: {
    runId: number;
    status: "ok" | "partial" | "error";
    completedAt: string;
    harvestedCount: number;
    candidateCount: number;
    notifiedCount: number;
    errorText?: string | null;
    stats?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `UPDATE housing_watch_runs
         SET completed_at = ?, status = ?, harvested_count = ?, candidate_count = ?, notified_count = ?, error_text = ?, stats_json = ?
         WHERE id = ?`
      )
      .run(
        input.completedAt,
        input.status,
        input.harvestedCount,
        input.candidateCount,
        input.notifiedCount,
        input.errorText ?? null,
        JSON.stringify(input.stats ?? {}),
        input.runId
      );
  }

  getHousingWatchCandidateByNoteId(noteId: string): HousingCandidateRecord | null {
    const row = this.db
      .prepare<unknown[], HousingCandidateRow>(
        `SELECT *
         FROM housing_watch_candidates
         WHERE note_id = ?
         LIMIT 1`
      )
      .get(noteId);

    return row ? mapHousingCandidateRow(row) : null;
  }

  upsertHousingWatchCandidate(input: {
    noteId: string;
    noteUrl: string;
    title: string;
    authorName?: string | null;
    city?: string | null;
    neighborhood?: string | null;
    locationSummary?: string | null;
    locationText?: string | null;
    postedAt?: string | null;
    seenAt: string;
    lastEvaluatedAt?: string | null;
    searchQueries: string[];
    bodyText: string;
    pageText: string;
    ocrText?: string | null;
    imageUrls: string[];
    screenshotCaptured: boolean;
    hardFilterDecision: HousingDecision;
    hardFilterReasons: string[];
    llmPromptVersion?: string | null;
    llmModelName?: string | null;
    llmInputHash?: string | null;
    llmOutput?: Record<string, unknown> | null;
    decision: HousingDecision;
    decisionReasons: string[];
    confidence?: number | null;
    unitType: string;
    wholeUnit: boolean | null;
    femaleOnly: boolean | null;
    sharedSpace: boolean | null;
    roommateOnly: boolean | null;
    availabilitySummary?: string | null;
    availabilityStart?: string | null;
    availabilityEnd?: string | null;
    commuteFriendly: boolean | null;
    rawPayload: Record<string, unknown>;
  }): HousingCandidateRecord {
    const existing = this.getHousingWatchCandidateByNoteId(input.noteId);

    if (!existing) {
      const inserted = this.db
        .prepare(
          `INSERT INTO housing_watch_candidates (
            note_id, note_url, title, author_name, city, neighborhood, location_summary, location_text, posted_at,
            first_seen_at, last_seen_at, last_evaluated_at, search_queries_json, body_text, page_text, ocr_text,
            image_urls_json, screenshot_captured, hard_filter_decision, hard_filter_reasons_json, llm_prompt_version,
            llm_model_name, llm_input_hash, llm_output_json, decision, decision_reasons_json, confidence, unit_type,
            whole_unit, female_only, shared_space, roommate_only, availability_summary, availability_start,
            availability_end, commute_friendly, raw_payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.noteId,
          input.noteUrl,
          input.title,
          input.authorName ?? null,
          input.city ?? null,
          input.neighborhood ?? null,
          input.locationSummary ?? null,
          input.locationText ?? null,
          input.postedAt ?? null,
          input.seenAt,
          input.seenAt,
          input.lastEvaluatedAt ?? null,
          JSON.stringify(uniqueStrings(input.searchQueries)),
          input.bodyText,
          input.pageText,
          input.ocrText ?? null,
          JSON.stringify(uniqueStrings(input.imageUrls)),
          input.screenshotCaptured ? 1 : 0,
          input.hardFilterDecision,
          JSON.stringify(input.hardFilterReasons),
          input.llmPromptVersion ?? null,
          input.llmModelName ?? null,
          input.llmInputHash ?? null,
          input.llmOutput ? JSON.stringify(input.llmOutput) : null,
          input.decision,
          JSON.stringify(input.decisionReasons),
          input.confidence ?? null,
          input.unitType,
          booleanToSql(input.wholeUnit),
          booleanToSql(input.femaleOnly),
          booleanToSql(input.sharedSpace),
          booleanToSql(input.roommateOnly),
          input.availabilitySummary ?? null,
          input.availabilityStart ?? null,
          input.availabilityEnd ?? null,
          booleanToSql(input.commuteFriendly),
          JSON.stringify(input.rawPayload)
        );

      return this.getHousingWatchCandidateById(Number(inserted.lastInsertRowid));
    }

    const mergedPayload = mergeRecords(existing.rawPayload, input.rawPayload);
    this.db
      .prepare(
        `UPDATE housing_watch_candidates
         SET note_url = ?, title = ?, author_name = ?, city = ?, neighborhood = ?, location_summary = ?, location_text = ?,
             posted_at = ?, last_seen_at = ?, last_evaluated_at = ?, search_queries_json = ?, body_text = ?, page_text = ?,
             ocr_text = ?, image_urls_json = ?, screenshot_captured = ?, hard_filter_decision = ?, hard_filter_reasons_json = ?,
             llm_prompt_version = ?, llm_model_name = ?, llm_input_hash = ?, llm_output_json = ?, decision = ?, decision_reasons_json = ?,
             confidence = ?, unit_type = ?, whole_unit = ?, female_only = ?, shared_space = ?, roommate_only = ?,
             availability_summary = ?, availability_start = ?, availability_end = ?, commute_friendly = ?, raw_payload_json = ?
         WHERE id = ?`
      )
      .run(
        input.noteUrl,
        preferLongerText(existing.title, input.title) ?? input.title,
        firstNonEmpty(input.authorName, existing.authorName) ?? null,
        firstNonEmpty(input.city, existing.city) ?? null,
        firstNonEmpty(input.neighborhood, existing.neighborhood) ?? null,
        firstNonEmpty(input.locationSummary, existing.locationSummary) ?? null,
        firstNonEmpty(input.locationText, existing.locationText) ?? null,
        firstNonEmpty(existing.postedAt, input.postedAt) ?? null,
        input.seenAt,
        input.lastEvaluatedAt ?? existing.lastEvaluatedAt ?? null,
        JSON.stringify(uniqueStrings([...existing.searchQueries, ...input.searchQueries])),
        preferLongerText(existing.bodyText, input.bodyText) ?? input.bodyText,
        preferLongerText(existing.pageText, input.pageText) ?? input.pageText,
        firstNonEmpty(input.ocrText, existing.ocrText) ?? null,
        JSON.stringify(uniqueStrings([...existing.imageUrls, ...input.imageUrls])),
        input.screenshotCaptured || existing.screenshotCaptured ? 1 : 0,
        input.hardFilterDecision,
        JSON.stringify(input.hardFilterReasons),
        input.llmPromptVersion ?? existing.llmPromptVersion ?? null,
        input.llmModelName ?? existing.llmModelName ?? null,
        input.llmInputHash ?? existing.llmInputHash ?? null,
        input.llmOutput ? JSON.stringify(input.llmOutput) : existing.llmOutputJson ? JSON.stringify(existing.llmOutputJson) : null,
        input.decision,
        JSON.stringify(input.decisionReasons),
        input.confidence ?? existing.confidence ?? null,
        input.unitType,
        booleanToSql(coalesceBoolean(input.wholeUnit, existing.wholeUnit)),
        booleanToSql(coalesceBoolean(input.femaleOnly, existing.femaleOnly)),
        booleanToSql(coalesceBoolean(input.sharedSpace, existing.sharedSpace)),
        booleanToSql(coalesceBoolean(input.roommateOnly, existing.roommateOnly)),
        firstNonEmpty(input.availabilitySummary, existing.availabilitySummary) ?? null,
        firstNonEmpty(input.availabilityStart, existing.availabilityStart) ?? null,
        firstNonEmpty(input.availabilityEnd, existing.availabilityEnd) ?? null,
        booleanToSql(coalesceBoolean(input.commuteFriendly, existing.commuteFriendly)),
        JSON.stringify(mergedPayload),
        existing.id
      );

    return this.getHousingWatchCandidateById(existing.id);
  }

  getHousingNotificationByDeliveryKey(deliveryKey: string): HousingNotificationRecord | null {
    const row = this.db
      .prepare<unknown[], HousingNotificationRow>(
        `SELECT *
         FROM housing_watch_notifications
         WHERE delivery_key = ?
         LIMIT 1`
      )
      .get(deliveryKey);

    return row ? mapHousingNotificationRow(row) : null;
  }

  findRecentHousingNotification(input: {
    notificationType: "candidate" | "maintenance";
    deliveryKey: string;
    sinceIso: string;
  }): HousingNotificationRecord | null {
    const row = this.db
      .prepare<unknown[], HousingNotificationRow>(
        `SELECT *
         FROM housing_watch_notifications
         WHERE notification_type = ? AND delivery_key = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(input.notificationType, input.deliveryKey, input.sinceIso);

    return row ? mapHousingNotificationRow(row) : null;
  }

  createHousingNotification(input: {
    candidateId?: number | null;
    notificationType: "candidate" | "maintenance";
    deliveryKey: string;
    destinationUserId: string;
    status: HousingNotificationRecord["status"];
    messageText: string;
    createdAt: string;
    errorText?: string | null;
  }): HousingNotificationRecord {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO housing_watch_notifications (
          candidate_id, notification_type, delivery_key, destination_user_id, status, message_text, error_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.candidateId ?? null,
        input.notificationType,
        input.deliveryKey,
        input.destinationUserId,
        input.status,
        input.messageText,
        input.errorText ?? null,
        input.createdAt
      );

    if (Number(result.changes) === 0) {
      const existing = this.getHousingNotificationByDeliveryKey(input.deliveryKey);
      if (!existing) {
        throw new Error(`Failed to load housing notification ${input.deliveryKey}`);
      }
      return existing;
    }

    const saved = this.getHousingNotificationByDeliveryKey(input.deliveryKey);
    if (!saved) {
      throw new Error(`Failed to load housing notification ${input.deliveryKey}`);
    }
    return saved;
  }

  updateHousingNotification(input: {
    id: number;
    status: HousingNotificationRecord["status"];
    sentAt?: string | null;
    errorText?: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE housing_watch_notifications
         SET status = ?, sent_at = ?, error_text = ?
         WHERE id = ?`
      )
      .run(input.status, input.sentAt ?? null, input.errorText ?? null, input.id);
  }

  recordRawItem(input: SourceItemInput): void {
    const payloadJson = JSON.stringify(input.rawPayload ?? input.metadata ?? {});
    const contentHash = sha256Hex(
      [input.sourceId, input.externalId, input.title, input.description ?? "", input.contentText ?? ""].join("|")
    );

    this.db
      .prepare(
        `INSERT OR IGNORE INTO raw_items (source_id, external_id, fetched_at, source_url, content_hash, payload_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.sourceId, input.externalId, input.fetchedAt, input.sourceUrl, contentHash, payloadJson);
  }

  upsertNormalizedItem(input: SourceItemInput): NormalizedItemRecord {
    this.recordRawItem(input);

    const normalizedTitle = normalizeTitle(input.title);
    const titleHash = sha256Hex(normalizedTitle);
    const sourceLayer = input.sourceLayer ?? inferSourceLayer(input.sourceId, input.sourceType);
    const canonicalUrl = canonicalizeUrl(input.canonicalUrl);
    const originalUrl = input.originalUrl ? canonicalizeUrl(input.originalUrl) : null;
    const sourceUrl = canonicalizeUrl(input.sourceUrl);
    const payloadMetadata = {
      ...(input.metadata ?? {}),
      rawExternalId: input.externalId
    };

    const exactMatch = this.db
      .prepare<unknown[], ExistingItemRow>(
        `SELECT *
         FROM normalized_items
         WHERE canonical_url = ?
            OR title_hash = ?
         ORDER BY source_authority DESC, last_seen_at DESC
         LIMIT 1`
      )
      .get(canonicalUrl, titleHash);

    const fuzzyMatch =
      exactMatch ??
      this.db
        .prepare<unknown[], ExistingItemRow>(
          `SELECT *
           FROM normalized_items
           WHERE last_seen_at >= datetime('now', '-30 days')
           ORDER BY last_seen_at DESC
           LIMIT 200`
        )
        .all()
        .find((row) => titleSimilarity(normalizedTitle, row.normalized_title) >= 0.94);

    if (!fuzzyMatch) {
      const inserted = this.db
        .prepare(
          `INSERT INTO normalized_items (
            canonical_url, title, normalized_title, title_hash, source_type, primary_source_layer, primary_source_id, primary_source_label,
            source_authority, source_labels_json, published_at, first_seen_at, last_seen_at, last_updated_at,
            item_kind, openai_category, geeknews_kind, repo_owner, repo_name, repo_language, repo_stars_today,
            repo_stars_total, description, content_text, source_url, original_url, metadata_json, keywords_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          canonicalUrl,
          collapseWhitespace(input.title),
          normalizedTitle,
          titleHash,
          input.sourceType,
          sourceLayer,
          input.sourceId,
          input.sourceLabel,
          input.sourceAuthority,
          JSON.stringify([input.sourceLabel]),
          input.publishedAt ?? null,
          input.fetchedAt,
          input.fetchedAt,
          input.fetchedAt,
          input.itemKind,
          input.openaiCategory ?? null,
          input.geeknewsKind ?? null,
          input.repoOwner ?? null,
          input.repoName ?? null,
          input.repoLanguage ?? null,
          input.repoStarsToday ?? null,
          input.repoStarsTotal ?? null,
          input.description ?? null,
          input.contentText ?? null,
          sourceUrl,
          originalUrl,
          JSON.stringify(payloadMetadata),
          JSON.stringify(uniqueStrings(input.keywords ?? []))
        );

      const itemId = Number(inserted.lastInsertRowid);
      this.insertItemSource(itemId, { ...input, sourceLayer }, sourceUrl, originalUrl);
      return this.getNormalizedItemById(itemId);
    }

    const merged = mergeExistingItem(fuzzyMatch, input, canonicalUrl, originalUrl, sourceUrl, payloadMetadata);

    this.db
      .prepare(
        `UPDATE normalized_items
         SET canonical_url = ?, title = ?, normalized_title = ?, title_hash = ?, source_type = ?, primary_source_layer = ?,
             primary_source_id = ?, primary_source_label = ?, source_authority = ?, source_labels_json = ?, published_at = ?, last_seen_at = ?,
             last_updated_at = ?, item_kind = ?, openai_category = ?, geeknews_kind = ?, repo_owner = ?, repo_name = ?,
             repo_language = ?, repo_stars_today = ?, repo_stars_total = ?, description = ?, content_text = ?, source_url = ?,
             original_url = ?, metadata_json = ?, keywords_json = ?
         WHERE id = ?`
      )
      .run(
        merged.canonical_url,
        merged.title,
        merged.normalized_title,
        merged.title_hash,
        merged.source_type,
        merged.primary_source_layer,
        merged.primary_source_id,
        merged.primary_source_label,
        merged.source_authority,
        merged.source_labels_json,
        merged.published_at,
        merged.last_seen_at,
        merged.last_updated_at,
        merged.item_kind,
        merged.openai_category,
        merged.geeknews_kind,
        merged.repo_owner,
        merged.repo_name,
        merged.repo_language,
        merged.repo_stars_today,
        merged.repo_stars_total,
        merged.description,
        merged.content_text,
        merged.source_url,
        merged.original_url,
        merged.metadata_json,
        merged.keywords_json,
        fuzzyMatch.id
      );

    this.insertItemSource(fuzzyMatch.id, { ...input, sourceLayer }, sourceUrl, originalUrl);
    return this.getNormalizedItemById(fuzzyMatch.id);
  }

  listCandidateItems(profileKey: ProfileKey, minSeenAtIso: string): NormalizedItemRecord[] {
    const rows = this.db
      .prepare<unknown[], CandidateItemRow>(
        `SELECT
           ni.*,
           (SELECT MAX(si.sent_at) FROM sent_items si WHERE si.profile_key = ? AND si.item_id = ni.id) AS last_sent_at,
           (SELECT COUNT(DISTINCT src.source_id) FROM item_sources src WHERE src.item_id = ni.id) AS cross_signal_count
         FROM normalized_items ni
         WHERE COALESCE(ni.published_at, ni.last_seen_at) >= ?
         ORDER BY COALESCE(ni.published_at, ni.last_seen_at) DESC`
      )
      .all(profileKey, minSeenAtIso);

    return rows.map((row) => this.hydrateNormalizedItem(row));
  }

  listRecentSentItems(profileKey: ProfileKey, sinceIso: string): RecentSentIdentity[] {
    return this.db
      .prepare<unknown[], RecentSentItemRow>(
        `SELECT
           si.item_id,
           si.sent_at,
           si.section_key,
           si.canonical_identity_hash,
           si.story_cluster_hash,
           si.title_snapshot,
           si.url_snapshot,
           si.content_source_hash,
           si.last_updated_snapshot,
           ni.normalized_title,
           ni.title_hash,
           ni.repo_owner,
           ni.repo_name,
           ni.source_type
         FROM sent_items si
         JOIN normalized_items ni ON ni.id = si.item_id
         WHERE si.profile_key = ?
           AND si.sent_at >= ?
         ORDER BY si.sent_at DESC`
      )
      .all(profileKey, sinceIso)
      .map((row) => {
        const repoKey =
          row.repo_owner && row.repo_name ? `${row.repo_owner}/${row.repo_name}`.toLowerCase() : null;
        return {
          itemId: row.item_id,
          sentAt: row.sent_at,
          sectionKey: row.section_key,
          canonicalIdentityHash:
            row.canonical_identity_hash ??
            sha256Hex(
              `canonical:${canonicalizeUrl((row.url_snapshot && row.url_snapshot.length > 0) ? row.url_snapshot : `https://suppressed.invalid/item/${row.item_id}`)}`
            ),
          storyClusterHash:
            row.story_cluster_hash ??
            sha256Hex(repoKey ? `repo:${repoKey}` : `story:${row.normalized_title ?? normalizeTitle(row.title_snapshot ?? "")}`),
          titleSnapshot: row.title_snapshot ?? "",
          urlSnapshot: row.url_snapshot ?? "",
          repoKey,
          normalizedTitle: row.normalized_title ?? normalizeTitle(row.title_snapshot ?? ""),
          titleHash: row.title_hash,
          sourceType: row.source_type as NormalizedItemRecord["sourceType"],
          contentSourceHash: row.content_source_hash,
          lastUpdatedSnapshot: row.last_updated_snapshot
        };
      });
  }

  getDailyLlmSpendUsd(profileKey: ProfileKey, sinceIso: string): number {
    const row = this.db
      .prepare<unknown[], { total_cost: number | null }>(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS total_cost
         FROM llm_runs
         WHERE profile_key = ?
           AND completed_at >= ?
           AND status IN ('ok', 'partial')`
      )
      .get(profileKey, sinceIso);

    return row?.total_cost ?? 0;
  }

  saveDigest(profileKey: ProfileKey, result: DigestBuildResult, generatedAt: string): SavedDigestRecord {
    const inserted = this.db
      .prepare(
        `INSERT INTO digests (
          profile_key, mode, generated_at, window_start, window_end, header, body_text, items_json, themes_json, stats_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profileKey,
        result.mode,
        generatedAt,
        result.window.startUtc,
        result.window.endUtc,
        result.header,
        result.bodyText,
        JSON.stringify(result.items),
        JSON.stringify(result.themes),
        JSON.stringify(result.stats)
      );

    const digestId = Number(inserted.lastInsertRowid);
    const sentStatement = this.db.prepare(
      `INSERT INTO sent_items (
        profile_key,
        digest_id,
        item_id,
        slot,
        sent_at,
        send_reason,
        section_key,
        canonical_identity_hash,
        story_cluster_hash,
        title_snapshot,
        url_snapshot,
        suppression_basis_json,
        override_reason,
        content_source_hash,
        last_updated_snapshot
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const followupStatement = this.db.prepare(
      `INSERT INTO followup_context (profile_key, digest_id, item_number, item_id, created_at, context_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((items: DigestEntry[]) => {
      items.forEach((item, index) => {
        const fingerprint = buildSuppressionFingerprintFromEntry(item);
        const articleContextMeta = asObject(item.metadata["articleContext"]);
        const suppressionMeta = asObject(item.metadata["suppression"]);
        sentStatement.run(
          profileKey,
          digestId,
          item.itemId,
          index + 1,
          generatedAt,
          item.sectionKey,
          item.sectionKey,
          fingerprint.canonicalIdentityHash,
          fingerprint.storyClusterHash,
          item.title,
          item.primaryUrl,
          JSON.stringify({
            sourceType: item.sourceType,
            itemKind: item.itemKind,
            repoKey: fingerprint.repoKey ?? null,
            matchedKeywords: item.keywords,
            score: item.score,
            suppressionReason: suppressionMeta.reason ?? null,
            overrideReason: suppressionMeta.overrideReason ?? null
          }),
          typeof suppressionMeta.overrideReason === "string" ? suppressionMeta.overrideReason : null,
          typeof articleContextMeta.sourceHash === "string" ? articleContextMeta.sourceHash : null,
          typeof item.metadata["lastUpdatedAt"] === "string" ? item.metadata["lastUpdatedAt"] : null
        );
        followupStatement.run(profileKey, digestId, item.number, item.itemId, generatedAt, JSON.stringify(item));
      });
    });

    transaction(result.items);
    return this.getDigestById(digestId)!;
  }

  getLatestDigest(profileKey: ProfileKey, mode?: string): SavedDigestRecord | null {
    const row = mode
      ? this.db
          .prepare<unknown[], DigestRow>(
            `SELECT * FROM digests WHERE profile_key = ? AND mode = ? ORDER BY generated_at DESC LIMIT 1`
          )
          .get(profileKey, mode)
      : this.db
          .prepare<unknown[], DigestRow>(`SELECT * FROM digests WHERE profile_key = ? ORDER BY generated_at DESC LIMIT 1`)
          .get(profileKey);

    return row ? mapDigestRow(row) : null;
  }

  getDigestById(id: number): SavedDigestRecord | null {
    const row = this.db.prepare<unknown[], DigestRow>(`SELECT * FROM digests WHERE id = ?`).get(id);
    return row ? mapDigestRow(row) : null;
  }

  getFollowupContext(profileKey: ProfileKey, itemNumber: number, digestId?: number): DigestEntry | null {
    const targetDigestId = digestId ?? this.getLatestDigest(profileKey)?.id;
    if (!targetDigestId) {
      return null;
    }

    const row = this.db
      .prepare<unknown[], { context_json: string }>(
        `SELECT context_json
         FROM followup_context
         WHERE profile_key = ? AND digest_id = ? AND item_number = ?`
      )
      .get(profileKey, targetDigestId, itemNumber);

    return row ? (JSON.parse(row.context_json) as DigestEntry) : null;
  }

  getItemSources(itemId: number): ItemSourceRecord[] {
    const rows = this.db
      .prepare<unknown[], ItemSourceRow>(
        `SELECT *
         FROM item_sources
         WHERE item_id = ?
         ORDER BY fetched_at DESC, source_label ASC`
      )
      .all(itemId);

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      sourceId: row.source_id as ItemSourceRecord["sourceId"],
      sourceType: row.source_type as SourceType,
      sourceLayer: row.source_layer as SourceLayer,
      sourceLabel: row.source_label,
      externalId: row.external_id,
      sourceUrl: row.source_url,
      originalUrl: row.original_url,
      title: row.title,
      publishedAt: row.published_at,
      fetchedAt: row.fetched_at,
      payload: JSON.parse(row.payload_json)
    }));
  }

  saveSignalEvents(events: SignalEventInput[]): SignalEventRecord[] {
    return events.map((event) => this.saveSignalEvent(event));
  }

  saveSignalEvent(input: SignalEventInput): SignalEventRecord {
    const sourceLayer = input.sourceLayer ?? "early_warning";
    const linkedUrl = input.linkedUrl ? canonicalizeUrl(input.linkedUrl) : null;
    const postUrl = canonicalizeUrl(input.postUrl);

    this.db
      .prepare(
        `INSERT INTO signal_events (
          source_id, source_layer, actor_label, actor_handle, post_url, linked_url, title, excerpt,
          published_at, fetched_at, metrics_json, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, post_url)
        DO UPDATE SET
          actor_label = excluded.actor_label,
          actor_handle = excluded.actor_handle,
          linked_url = excluded.linked_url,
          title = excluded.title,
          excerpt = excluded.excerpt,
          published_at = excluded.published_at,
          fetched_at = excluded.fetched_at,
          metrics_json = excluded.metrics_json,
          metadata_json = excluded.metadata_json`
      )
      .run(
        input.sourceId,
        sourceLayer,
        collapseWhitespace(input.actorLabel),
        input.actorHandle ?? null,
        postUrl,
        linkedUrl,
        input.title ? collapseWhitespace(input.title) : null,
        input.excerpt ? collapseWhitespace(input.excerpt) : null,
        input.publishedAt ?? null,
        input.fetchedAt,
        JSON.stringify(input.metrics ?? {}),
        JSON.stringify(input.metadata ?? {})
      );

    const saved = this.db
      .prepare<unknown[], SignalEventRow>(
        `SELECT *
         FROM signal_events
         WHERE source_id = ? AND post_url = ?
         LIMIT 1`
      )
      .get(input.sourceId, postUrl);

    if (!saved) {
      throw new Error(`Failed to load saved signal event for ${postUrl}`);
    }

    return mapSignalEventRow(saved);
  }

  matchRecentSignalEvents(minFetchedAtIso: string): number {
    const signals = this.db
      .prepare<unknown[], SignalEventRow>(
        `SELECT *
         FROM signal_events
         WHERE fetched_at >= ?
         ORDER BY fetched_at DESC`
      )
      .all(minFetchedAtIso)
      .map((row) => mapSignalEventRow(row));

    let matched = 0;
    const insert = this.db.prepare(
      `INSERT INTO signal_event_matches (
        signal_event_id, item_id, match_type, boost_score, created_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(signal_event_id, item_id)
      DO UPDATE SET
        match_type = excluded.match_type,
        boost_score = excluded.boost_score,
        created_at = excluded.created_at`
    );

    for (const signal of signals) {
      const match = this.findBestItemForSignal(signal, minFetchedAtIso);
      if (!match) {
        continue;
      }

      insert.run(signal.id, match.itemId, match.matchType, match.boostScore, signal.fetchedAt);
      matched += 1;
    }

    return matched;
  }

  listUnmatchedSignalEvents(limit: number, minFetchedAtIso?: string): SignalEventRecord[] {
    const rows = minFetchedAtIso
      ? this.db
          .prepare<unknown[], SignalEventRow>(
            `SELECT se.*
             FROM signal_events se
             LEFT JOIN signal_event_matches sem ON sem.signal_event_id = se.id
             WHERE sem.id IS NULL AND se.fetched_at >= ?
             ORDER BY se.fetched_at DESC
             LIMIT ?`
          )
          .all(minFetchedAtIso, limit)
      : this.db
          .prepare<unknown[], SignalEventRow>(
            `SELECT se.*
             FROM signal_events se
             LEFT JOIN signal_event_matches sem ON sem.signal_event_id = se.id
             WHERE sem.id IS NULL
             ORDER BY se.fetched_at DESC
             LIMIT ?`
          )
          .all(limit);

    return rows.map((row) => mapSignalEventRow(row));
  }

  getSignalMatchesForItem(itemId: number): SignalMatchRecord[] {
    const rows = this.db
      .prepare<unknown[], SignalMatchRow>(
        `SELECT
           sem.id AS match_id,
           sem.signal_event_id,
           sem.item_id,
           sem.match_type,
           sem.boost_score,
           se.id AS signal_id,
           se.source_id,
           se.source_layer,
           se.actor_label,
           se.actor_handle,
           se.post_url,
           se.linked_url,
           se.title,
           se.excerpt,
           se.published_at,
           se.fetched_at,
           se.metrics_json,
           se.metadata_json
         FROM signal_event_matches sem
         JOIN signal_events se ON se.id = sem.signal_event_id
         WHERE sem.item_id = ?
         ORDER BY sem.created_at DESC, se.actor_label ASC`
      )
      .all(itemId);

    return rows.map((row) => ({
      id: row.match_id,
      signalEventId: row.signal_event_id,
      itemId: row.item_id,
      matchType: row.match_type as SignalMatchRecord["matchType"],
      boostScore: row.boost_score,
      signal: mapSignalEventRow(row)
    }));
  }

  startLlmRun(input: {
    profileKey: ProfileKey;
    runType: LlmRunType;
    taskKey?: LlmTaskKey;
    taskTier?: LlmTaskTier;
    provider?: LlmProvider;
    modelName: string;
    promptVersion: string;
    inputHash: string;
    startedAt: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO llm_runs (
          profile_key,
          run_type,
          task_key,
          task_tier,
          provider,
          model_name,
          prompt_version,
          input_hash,
          started_at,
          status
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')`
      )
      .run(
        input.profileKey,
        input.runType,
        input.taskKey ?? null,
        input.taskTier ?? null,
        input.provider ?? null,
        input.modelName,
        input.promptVersion,
        input.inputHash,
        input.startedAt
      );

    return Number(result.lastInsertRowid);
  }

  finishLlmRun(input: {
    runId: number;
    status: LlmRunRecord["status"];
    completedAt: string;
    latencyMs?: number | null;
    tokenUsage?: Record<string, unknown> | null;
    estimatedCostUsd?: number | null;
    errorText?: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE llm_runs
         SET completed_at = ?, status = ?, latency_ms = ?, token_usage_json = ?, estimated_cost_usd = ?, error_text = ?
         WHERE id = ?`
      )
      .run(
        input.completedAt,
        input.status,
        input.latencyMs ?? null,
        input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
        input.estimatedCostUsd ?? null,
        input.errorText ?? null,
        input.runId
      );
  }

  getItemEnrichment(
    profileKey: ProfileKey,
    itemId: number,
    promptVersion: string,
    sourceHash: string
  ): ItemEnrichmentRecord | null {
    const row = this.db
      .prepare<unknown[], ItemEnrichmentRow>(
        `SELECT *
         FROM item_enrichments
         WHERE profile_key = ? AND item_id = ? AND prompt_version = ? AND source_hash = ?
         LIMIT 1`
      )
      .get(profileKey, itemId, promptVersion, sourceHash);

    return row ? mapItemEnrichmentRow(row) : null;
  }

  saveItemEnrichment(input: {
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
  }): ItemEnrichmentRecord {
    this.db
      .prepare(
        `INSERT INTO item_enrichments (
          profile_key, item_id, llm_run_id, prompt_version, source_hash, summary_ko, why_important_ko,
          what_changed_ko, engineer_relevance_ko, ai_ecosystem_ko, openai_angle_ko, trend_signal_ko,
          cause_effect_ko, watchpoints_json, evidence_spans_json, novelty_score, insight_score,
          confidence, uncertainty_notes_json, theme_tags_json, officialness_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, prompt_version, source_hash)
        DO UPDATE SET
          profile_key = excluded.profile_key,
          llm_run_id = excluded.llm_run_id,
          summary_ko = excluded.summary_ko,
          why_important_ko = excluded.why_important_ko,
          what_changed_ko = excluded.what_changed_ko,
          engineer_relevance_ko = excluded.engineer_relevance_ko,
          ai_ecosystem_ko = excluded.ai_ecosystem_ko,
          openai_angle_ko = excluded.openai_angle_ko,
          trend_signal_ko = excluded.trend_signal_ko,
          cause_effect_ko = excluded.cause_effect_ko,
          watchpoints_json = excluded.watchpoints_json,
          evidence_spans_json = excluded.evidence_spans_json,
          novelty_score = excluded.novelty_score,
          insight_score = excluded.insight_score,
          confidence = excluded.confidence,
          uncertainty_notes_json = excluded.uncertainty_notes_json,
          theme_tags_json = excluded.theme_tags_json,
          officialness_note = excluded.officialness_note,
          created_at = excluded.created_at`
      )
      .run(
        input.profileKey,
        input.itemId,
        input.llmRunId ?? null,
        input.promptVersion,
        input.sourceHash,
        input.summaryKo,
        input.whyImportantKo,
        input.whatChangedKo ?? null,
        input.engineerRelevanceKo ?? null,
        input.aiEcosystemKo ?? null,
        input.openAiAngleKo ?? null,
        input.trendSignalKo ?? null,
        input.causeEffectKo ?? null,
        JSON.stringify(input.watchpoints),
        JSON.stringify(input.evidenceSpans),
        input.noveltyScore ?? null,
        input.insightScore ?? null,
        input.confidence,
        JSON.stringify(input.uncertaintyNotes),
        JSON.stringify(input.themeTags),
        input.officialnessNote ?? null,
        input.createdAt
      );

    const saved = this.getItemEnrichment(input.profileKey, input.itemId, input.promptVersion, input.sourceHash);
    if (!saved) {
      throw new Error(`Failed to load saved item enrichment for item ${input.itemId}`);
    }
    return saved;
  }

  getArticleContext(itemId: number, sourceHash: string): ArticleContextRecord | null {
    const row = this.db
      .prepare<unknown[], ArticleContextRow>(
        `SELECT *
         FROM article_contexts
         WHERE item_id = ? AND source_hash = ?
         LIMIT 1`
      )
      .get(itemId, sourceHash);

    return row ? mapArticleContextRow(row) : null;
  }

  getLatestArticleContext(itemId: number): ArticleContextRecord | null {
    const row = this.db
      .prepare<unknown[], ArticleContextRow>(
        `SELECT *
         FROM article_contexts
         WHERE item_id = ?
         ORDER BY fetched_at DESC
         LIMIT 1`
      )
      .get(itemId);

    return row ? mapArticleContextRow(row) : null;
  }

  saveArticleContext(input: {
    itemId: number;
    sourceHash: string;
    canonicalUrl: string;
    fetchStatus: ArticleContextRecord["fetchStatus"];
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
  }): ArticleContextRecord {
    this.db
      .prepare(
        `INSERT INTO article_contexts (
          item_id, source_hash, canonical_url, fetch_status, publisher, author, published_at,
          headline, dek, clean_text, key_sections_json, evidence_snippets_json, word_count, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, source_hash)
        DO UPDATE SET
          canonical_url = excluded.canonical_url,
          fetch_status = excluded.fetch_status,
          publisher = excluded.publisher,
          author = excluded.author,
          published_at = excluded.published_at,
          headline = excluded.headline,
          dek = excluded.dek,
          clean_text = excluded.clean_text,
          key_sections_json = excluded.key_sections_json,
          evidence_snippets_json = excluded.evidence_snippets_json,
          word_count = excluded.word_count,
          fetched_at = excluded.fetched_at`
      )
      .run(
        input.itemId,
        input.sourceHash,
        input.canonicalUrl,
        input.fetchStatus,
        input.publisher ?? null,
        input.author ?? null,
        input.publishedAt ?? null,
        input.headline,
        input.dek ?? null,
        input.cleanText,
        JSON.stringify(input.keySections),
        JSON.stringify(input.evidenceSnippets),
        input.wordCount,
        input.fetchedAt
      );

    const saved = this.getArticleContext(input.itemId, input.sourceHash);
    if (!saved) {
      throw new Error(`Failed to load saved article context for item ${input.itemId}`);
    }
    return saved;
  }

  getDigestThemeEnrichment(
    profileKey: ProfileKey,
    digestCacheKey: string,
    promptVersion: string
  ): DigestThemeEnrichmentRecord | null {
    const row = this.db
      .prepare<unknown[], DigestEnrichmentRow>(
        `SELECT *
         FROM digest_enrichments
         WHERE profile_key = ? AND digest_cache_key = ? AND prompt_version = ?
         LIMIT 1`
      )
      .get(profileKey, digestCacheKey, promptVersion);

    return row ? mapDigestEnrichmentRow(row) : null;
  }

  saveDigestThemeEnrichment(input: {
    profileKey: ProfileKey;
    digestCacheKey: string;
    digestMode: DigestMode;
    llmRunId?: number | null;
    promptVersion: string;
    themes: string[];
    createdAt: string;
  }): DigestThemeEnrichmentRecord {
    this.db
      .prepare(
        `INSERT INTO digest_enrichments (
          profile_key, digest_cache_key, digest_mode, llm_run_id, prompt_version, themes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(digest_cache_key, prompt_version)
        DO UPDATE SET
          profile_key = excluded.profile_key,
          digest_mode = excluded.digest_mode,
          llm_run_id = excluded.llm_run_id,
          themes_json = excluded.themes_json,
          created_at = excluded.created_at`
      )
      .run(
        input.profileKey,
        input.digestCacheKey,
        input.digestMode,
        input.llmRunId ?? null,
        input.promptVersion,
        JSON.stringify(input.themes),
        input.createdAt
      );

    const saved = this.getDigestThemeEnrichment(input.profileKey, input.digestCacheKey, input.promptVersion);
    if (!saved) {
      throw new Error(`Failed to load saved digest theme enrichment for cache key ${input.digestCacheKey}`);
    }
    return saved;
  }

  private findBestItemForSignal(
    signal: SignalEventRecord,
    minFetchedAtIso: string
  ): { itemId: number; matchType: SignalMatchRecord["matchType"]; boostScore: number } | null {
    if (signal.linkedUrl) {
      const exact = this.db
        .prepare<unknown[], { id: number }>(
          `SELECT id
           FROM normalized_items
           WHERE canonical_url = ? OR original_url = ? OR source_url = ?
           ORDER BY source_authority DESC, last_seen_at DESC
           LIMIT 1`
        )
        .get(signal.linkedUrl, signal.linkedUrl, signal.linkedUrl);

      if (exact) {
        return {
          itemId: exact.id,
          matchType: "linked_url",
          boostScore: 2
        };
      }
    }

    if (!signal.linkedUrl || !signal.title) {
      return null;
    }

    const recentRows = this.db
      .prepare<unknown[], ExistingItemRow>(
        `SELECT *
         FROM normalized_items
         WHERE COALESCE(published_at, last_seen_at) >= ?
         ORDER BY last_seen_at DESC
         LIMIT 120`
      )
      .all(minFetchedAtIso);

    const candidate = recentRows
      .map((row) => ({
        row,
        similarity: titleSimilarity(signal.title ?? "", row.title)
      }))
      .filter((entry) => entry.similarity >= 0.9)
      .sort((left, right) => right.similarity - left.similarity || right.row.source_authority - left.row.source_authority)[0];

    if (!candidate) {
      return null;
    }

    return {
      itemId: candidate.row.id,
      matchType: "title_similarity",
      boostScore: 2
    };
  }

  private insertItemSource(itemId: number, input: SourceItemInput, sourceUrl: string, originalUrl: string | null): void {
    const sourceLayer = input.sourceLayer ?? inferSourceLayer(input.sourceId, input.sourceType);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO item_sources (
          item_id, source_id, source_type, source_layer, source_label, external_id, source_url, original_url,
          title, published_at, fetched_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        itemId,
        input.sourceId,
        input.sourceType,
        sourceLayer,
        input.sourceLabel,
        input.externalId,
        sourceUrl,
        originalUrl,
        input.title,
        input.publishedAt ?? null,
        input.fetchedAt,
        JSON.stringify(input.rawPayload ?? input.metadata ?? {})
      );
  }

  private getHousingWatchCandidateById(id: number): HousingCandidateRecord {
    const row = this.db
      .prepare<unknown[], HousingCandidateRow>(
        `SELECT *
         FROM housing_watch_candidates
         WHERE id = ?`
      )
      .get(id);

    if (!row) {
      throw new Error(`Housing watch candidate ${id} not found`);
    }

    return mapHousingCandidateRow(row);
  }

  private getNormalizedItemById(id: number): NormalizedItemRecord {
    const row = this.db
      .prepare<unknown[], CandidateItemRow>(
        `SELECT
           ni.*,
           (SELECT MAX(si.sent_at) FROM sent_items si WHERE si.item_id = ni.id) AS last_sent_at,
           (SELECT COUNT(DISTINCT src.source_id) FROM item_sources src WHERE src.item_id = ni.id) AS cross_signal_count
         FROM normalized_items ni
         WHERE ni.id = ?`
      )
      .get(id);

    if (!row) {
      throw new Error(`Normalized item ${id} not found after upsert`);
    }

    return this.hydrateNormalizedItem(row);
  }

  private hydrateNormalizedItem(row: CandidateItemRow): NormalizedItemRecord {
    return {
      id: row.id,
      canonicalUrl: row.canonical_url,
      title: row.title,
      normalizedTitle: row.normalized_title,
      titleHash: row.title_hash,
      sourceType: row.source_type as NormalizedItemRecord["sourceType"],
      primarySourceLayer: row.primary_source_layer as SourceLayer,
      primarySourceId: row.primary_source_id as NormalizedItemRecord["primarySourceId"],
      primarySourceLabel: row.primary_source_label,
      sourceAuthority: row.source_authority,
      sourceLabels: JSON.parse(row.source_labels_json),
      publishedAt: row.published_at,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastUpdatedAt: row.last_updated_at,
      itemKind: row.item_kind as NormalizedItemRecord["itemKind"],
      openaiCategory: row.openai_category as NormalizedItemRecord["openaiCategory"],
      geeknewsKind: row.geeknews_kind as NormalizedItemRecord["geeknewsKind"],
      repoOwner: row.repo_owner,
      repoName: row.repo_name,
      repoLanguage: row.repo_language,
      repoStarsToday: row.repo_stars_today,
      repoStarsTotal: row.repo_stars_total,
      description: row.description,
      contentText: row.content_text,
      sourceUrl: row.source_url,
      originalUrl: row.original_url,
      metadata: JSON.parse(row.metadata_json),
      keywords: JSON.parse(row.keywords_json),
      lastSentAt: row.last_sent_at,
      crossSignalCount: row.cross_signal_count ?? 1,
      sources: this.getItemSources(row.id),
      matchedSignals: this.getSignalMatchesForItem(row.id)
    };
  }
}

function mergeExistingItem(
  existing: ExistingItemRow,
  input: SourceItemInput,
  canonicalUrl: string,
  originalUrl: string | null,
  sourceUrl: string,
  payloadMetadata: Record<string, unknown>
): ExistingItemRow {
  const currentMetadata = JSON.parse(existing.metadata_json) as Record<string, unknown>;
  const currentKeywords = JSON.parse(existing.keywords_json) as string[];
  const currentLabels = JSON.parse(existing.source_labels_json) as string[];

  const incomingTitle = collapseWhitespace(input.title);
  const primarySourceShouldSwitch =
    input.sourceAuthority > existing.source_authority ||
    (input.sourceType === "openai_official" && existing.source_type !== "openai_official");
  const sourceLayer = input.sourceLayer ?? inferSourceLayer(input.sourceId, input.sourceType);

  const mergedMetadata = mergeRecords(currentMetadata, payloadMetadata);
  const mergedKeywords = uniqueStrings([...(currentKeywords ?? []), ...(input.keywords ?? [])]);
  const mergedLabels = uniqueStrings([...(currentLabels ?? []), input.sourceLabel]);

  const nextCanonicalUrl = shouldPreferIncomingCanonical(existing.canonical_url, canonicalUrl) ? canonicalUrl : existing.canonical_url;
  const nextOriginalUrl = firstNonEmpty(originalUrl, existing.original_url);
  const nextDescription = preferLongerText(existing.description, input.description);
  const nextContent = preferLongerText(existing.content_text, input.contentText);
  const changedContentHash = sha256Hex(
    [existing.title, existing.description ?? "", existing.content_text ?? ""].join("|")
  );
  const incomingContentHash = sha256Hex([incomingTitle, input.description ?? "", input.contentText ?? ""].join("|"));

  return {
    ...existing,
    canonical_url: nextCanonicalUrl,
    title: primarySourceShouldSwitch ? incomingTitle : existing.title,
    normalized_title: primarySourceShouldSwitch ? normalizeTitle(incomingTitle) : existing.normalized_title,
    title_hash: primarySourceShouldSwitch ? sha256Hex(normalizeTitle(incomingTitle)) : existing.title_hash,
    source_type: primarySourceShouldSwitch ? input.sourceType : existing.source_type,
    primary_source_layer: primarySourceShouldSwitch ? sourceLayer : existing.primary_source_layer,
    primary_source_id: primarySourceShouldSwitch ? input.sourceId : existing.primary_source_id,
    primary_source_label: primarySourceShouldSwitch ? input.sourceLabel : existing.primary_source_label,
    source_authority: Math.max(existing.source_authority, input.sourceAuthority),
    source_labels_json: JSON.stringify(mergedLabels),
    published_at: firstNonEmpty(existing.published_at, input.publishedAt) ?? null,
    last_seen_at: input.fetchedAt,
    last_updated_at: changedContentHash !== incomingContentHash ? input.fetchedAt : existing.last_updated_at,
    item_kind: primarySourceShouldSwitch ? input.itemKind : existing.item_kind,
    openai_category: firstNonEmpty(input.openaiCategory, existing.openai_category) ?? null,
    geeknews_kind: firstNonEmpty(input.geeknewsKind, existing.geeknews_kind) ?? null,
    repo_owner: firstNonEmpty(input.repoOwner, existing.repo_owner) ?? null,
    repo_name: firstNonEmpty(input.repoName, existing.repo_name) ?? null,
    repo_language: firstNonEmpty(input.repoLanguage, existing.repo_language) ?? null,
    repo_stars_today: input.repoStarsToday ?? existing.repo_stars_today,
    repo_stars_total: input.repoStarsTotal ?? existing.repo_stars_total,
    description: nextDescription ?? null,
    content_text: nextContent ?? null,
    source_url: primarySourceShouldSwitch ? sourceUrl : existing.source_url,
    original_url: nextOriginalUrl ?? null,
    metadata_json: JSON.stringify(mergedMetadata),
    keywords_json: JSON.stringify(mergedKeywords)
  };
}

function mergeRecords(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const current = merged[key];
    if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = [...new Set([...current, ...value])];
      continue;
    }

    if (current && typeof current === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeRecords(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    merged[key] = value;
  }
  return merged;
}

function preferLongerText(left?: string | null, right?: string | null): string | undefined {
  if (!left) {
    return right ?? undefined;
  }
  if (!right) {
    return left;
  }
  return right.length > left.length ? right : left;
}

function shouldPreferIncomingCanonical(existingUrl: string, incomingUrl: string): boolean {
  const existingHost = new URL(existingUrl).hostname;
  const incomingHost = new URL(incomingUrl).hostname;

  if (existingHost === incomingHost) {
    return incomingUrl.length < existingUrl.length;
  }

  if (existingHost === "news.hada.io" && incomingHost !== "news.hada.io") {
    return true;
  }

  if (incomingHost === "news.hada.io") {
    return false;
  }

  return false;
}

function mapDigestRow(row: DigestRow): SavedDigestRecord {
  return {
    id: row.id,
    profileKey: row.profile_key as ProfileKey,
    mode: row.mode as SavedDigestRecord["mode"],
    generatedAt: row.generated_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    header: row.header,
    bodyText: row.body_text,
    items: JSON.parse(row.items_json),
    themes: JSON.parse(row.themes_json),
    stats: JSON.parse(row.stats_json)
  };
}

function mapItemEnrichmentRow(row: ItemEnrichmentRow): ItemEnrichmentRecord {
  return {
    id: row.id,
    profileKey: row.profile_key as ProfileKey,
    itemId: row.item_id,
    llmRunId: row.llm_run_id,
    promptVersion: row.prompt_version,
    sourceHash: row.source_hash,
    summaryKo: row.summary_ko,
    whyImportantKo: row.why_important_ko,
    whatChangedKo: row.what_changed_ko,
    engineerRelevanceKo: row.engineer_relevance_ko,
    aiEcosystemKo: row.ai_ecosystem_ko,
    openAiAngleKo: row.openai_angle_ko,
    trendSignalKo: row.trend_signal_ko,
    causeEffectKo: row.cause_effect_ko,
    watchpoints: JSON.parse(row.watchpoints_json),
    evidenceSpans: JSON.parse(row.evidence_spans_json),
    noveltyScore: row.novelty_score,
    insightScore: row.insight_score,
    confidence: row.confidence,
    uncertaintyNotes: JSON.parse(row.uncertainty_notes_json),
    themeTags: JSON.parse(row.theme_tags_json),
    officialnessNote: row.officialness_note,
    createdAt: row.created_at
  };
}

function mapArticleContextRow(row: ArticleContextRow): ArticleContextRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    sourceHash: row.source_hash,
    canonicalUrl: row.canonical_url,
    fetchStatus: row.fetch_status as ArticleContextRecord["fetchStatus"],
    publisher: row.publisher,
    author: row.author,
    publishedAt: row.published_at,
    headline: row.headline,
    dek: row.dek,
    cleanText: row.clean_text,
    keySections: JSON.parse(row.key_sections_json),
    evidenceSnippets: JSON.parse(row.evidence_snippets_json),
    wordCount: row.word_count,
    fetchedAt: row.fetched_at
  };
}

function mapDigestEnrichmentRow(row: DigestEnrichmentRow): DigestThemeEnrichmentRecord {
  return {
    id: row.id,
    profileKey: row.profile_key as ProfileKey,
    digestCacheKey: row.digest_cache_key,
    digestMode: row.digest_mode as DigestMode,
    llmRunId: row.llm_run_id,
    promptVersion: row.prompt_version,
    themes: JSON.parse(row.themes_json),
    createdAt: row.created_at
  };
}

function mapSignalEventRow(row: SignalEventRow): SignalEventRecord {
  return {
    id: row.signal_id ?? row.id ?? 0,
    sourceId: row.source_id as SignalEventRecord["sourceId"],
    sourceLayer: row.source_layer as SignalEventRecord["sourceLayer"],
    actorLabel: row.actor_label,
    actorHandle: row.actor_handle,
    postUrl: row.post_url,
    linkedUrl: row.linked_url,
    title: row.title,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    metrics: JSON.parse(row.metrics_json),
    metadata: JSON.parse(row.metadata_json)
  };
}

function mapHousingCandidateRow(row: HousingCandidateRow): HousingCandidateRecord {
  return {
    id: row.id,
    noteId: row.note_id,
    noteUrl: row.note_url,
    title: row.title,
    authorName: row.author_name,
    city: row.city,
    neighborhood: row.neighborhood,
    locationSummary: row.location_summary,
    locationText: row.location_text,
    postedAt: row.posted_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastEvaluatedAt: row.last_evaluated_at,
    searchQueries: JSON.parse(row.search_queries_json),
    bodyText: row.body_text,
    pageText: row.page_text,
    ocrText: row.ocr_text,
    imageUrls: JSON.parse(row.image_urls_json),
    screenshotCaptured: row.screenshot_captured === 1,
    hardFilterDecision: row.hard_filter_decision as HousingDecision,
    hardFilterReasons: JSON.parse(row.hard_filter_reasons_json),
    llmPromptVersion: row.llm_prompt_version,
    llmModelName: row.llm_model_name,
    llmInputHash: row.llm_input_hash,
    llmOutputJson: row.llm_output_json ? JSON.parse(row.llm_output_json) : null,
    decision: row.decision as HousingDecision,
    decisionReasons: JSON.parse(row.decision_reasons_json),
    confidence: row.confidence,
    unitType: row.unit_type as HousingCandidateRecord["unitType"],
    wholeUnit: sqlToBoolean(row.whole_unit),
    femaleOnly: sqlToBoolean(row.female_only),
    sharedSpace: sqlToBoolean(row.shared_space),
    roommateOnly: sqlToBoolean(row.roommate_only),
    availabilitySummary: row.availability_summary,
    availabilityStart: row.availability_start,
    availabilityEnd: row.availability_end,
    commuteFriendly: sqlToBoolean(row.commute_friendly),
    rawPayload: JSON.parse(row.raw_payload_json)
  };
}

function mapHousingNotificationRow(row: HousingNotificationRow): HousingNotificationRecord {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    notificationType: row.notification_type as HousingNotificationRecord["notificationType"],
    deliveryKey: row.delivery_key,
    destinationUserId: row.destination_user_id,
    status: row.status as HousingNotificationRecord["status"],
    messageText: row.message_text,
    errorText: row.error_text,
    createdAt: row.created_at,
    sentAt: row.sent_at
  };
}

function booleanToSql(value: boolean | null): number | null {
  if (value == null) {
    return null;
  }
  return value ? 1 : 0;
}

function sqlToBoolean(value?: number | null): boolean | null {
  if (value == null) {
    return null;
  }
  return value === 1;
}

function coalesceBoolean(incoming?: boolean | null, existing?: boolean | null): boolean | null {
  return incoming == null ? existing ?? null : incoming;
}

interface ExistingItemRow {
  id: number;
  canonical_url: string;
  title: string;
  normalized_title: string;
  title_hash: string;
  source_type: string;
  primary_source_layer: string;
  primary_source_id: string;
  primary_source_label: string;
  source_authority: number;
  source_labels_json: string;
  published_at?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_updated_at: string;
  item_kind: string;
  openai_category?: string | null;
  geeknews_kind?: string | null;
  repo_owner?: string | null;
  repo_name?: string | null;
  repo_language?: string | null;
  repo_stars_today?: number | null;
  repo_stars_total?: number | null;
  description?: string | null;
  content_text?: string | null;
  source_url: string;
  original_url?: string | null;
  metadata_json: string;
  keywords_json: string;
}

interface CandidateItemRow extends ExistingItemRow {
  last_sent_at?: string | null;
  cross_signal_count: number;
}

interface RecentSentItemRow {
  item_id: number;
  sent_at: string;
  section_key?: string | null;
  canonical_identity_hash?: string | null;
  story_cluster_hash?: string | null;
  title_snapshot?: string | null;
  url_snapshot?: string | null;
  content_source_hash?: string | null;
  last_updated_snapshot?: string | null;
  normalized_title?: string | null;
  title_hash?: string | null;
  repo_owner?: string | null;
  repo_name?: string | null;
  source_type: string;
}

interface ItemSourceRow {
  id: number;
  item_id: number;
  source_id: string;
  source_type: string;
  source_layer: string;
  source_label: string;
  external_id: string;
  source_url: string;
  original_url?: string | null;
  title: string;
  published_at?: string | null;
  fetched_at: string;
  payload_json: string;
}

interface DigestRow {
  id: number;
  profile_key: string;
  mode: string;
  generated_at: string;
  window_start: string;
  window_end: string;
  header: string;
  body_text: string;
  items_json: string;
  themes_json: string;
  stats_json: string;
}

interface ItemEnrichmentRow {
  id: number;
  profile_key: string;
  item_id: number;
  llm_run_id?: number | null;
  prompt_version: string;
  source_hash: string;
  summary_ko: string;
  why_important_ko: string;
  what_changed_ko?: string | null;
  engineer_relevance_ko?: string | null;
  ai_ecosystem_ko?: string | null;
  openai_angle_ko?: string | null;
  trend_signal_ko?: string | null;
  cause_effect_ko?: string | null;
  watchpoints_json: string;
  evidence_spans_json: string;
  novelty_score?: number | null;
  insight_score?: number | null;
  confidence: number;
  uncertainty_notes_json: string;
  theme_tags_json: string;
  officialness_note?: string | null;
  created_at: string;
}

interface ArticleContextRow {
  id: number;
  item_id: number;
  source_hash: string;
  canonical_url: string;
  fetch_status: string;
  publisher?: string | null;
  author?: string | null;
  published_at?: string | null;
  headline: string;
  dek?: string | null;
  clean_text: string;
  key_sections_json: string;
  evidence_snippets_json: string;
  word_count: number;
  fetched_at: string;
}

interface DigestEnrichmentRow {
  id: number;
  profile_key: string;
  digest_cache_key: string;
  digest_mode: string;
  llm_run_id?: number | null;
  prompt_version: string;
  themes_json: string;
  created_at: string;
}

interface SignalEventRow {
  id?: number;
  signal_id?: number;
  source_id: string;
  source_layer: string;
  actor_label: string;
  actor_handle?: string | null;
  post_url: string;
  linked_url?: string | null;
  title?: string | null;
  excerpt?: string | null;
  published_at?: string | null;
  fetched_at: string;
  metrics_json: string;
  metadata_json: string;
}

interface HousingCandidateRow {
  id: number;
  note_id: string;
  note_url: string;
  title: string;
  author_name?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  location_summary?: string | null;
  location_text?: string | null;
  posted_at?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_evaluated_at?: string | null;
  search_queries_json: string;
  body_text: string;
  page_text: string;
  ocr_text?: string | null;
  image_urls_json: string;
  screenshot_captured: number;
  hard_filter_decision: string;
  hard_filter_reasons_json: string;
  llm_prompt_version?: string | null;
  llm_model_name?: string | null;
  llm_input_hash?: string | null;
  llm_output_json?: string | null;
  decision: string;
  decision_reasons_json: string;
  confidence?: number | null;
  unit_type: string;
  whole_unit?: number | null;
  female_only?: number | null;
  shared_space?: number | null;
  roommate_only?: number | null;
  availability_summary?: string | null;
  availability_start?: string | null;
  availability_end?: string | null;
  commute_friendly?: number | null;
  raw_payload_json: string;
}

interface HousingNotificationRow {
  id: number;
  candidate_id?: number | null;
  notification_type: string;
  delivery_key: string;
  destination_user_id: string;
  status: string;
  message_text: string;
  error_text?: string | null;
  created_at: string;
  sent_at?: string | null;
}

interface SignalMatchRow extends SignalEventRow {
  match_id: number;
  signal_event_id: number;
  item_id: number;
  match_type: string;
  boost_score: number;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
