import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { canonicalizeUrl, normalizeTitle, sha256Hex } from "./util/canonicalize.js";
import { titleSimilarity } from "./util/dedupe.js";
import { collapseWhitespace, firstNonEmpty, uniqueStrings } from "./util/text.js";
import type {
  DigestBuildResult,
  DigestMode,
  DigestEntry,
  DigestThemeEnrichmentRecord,
  ItemEnrichmentRecord,
  SignalEventInput,
  SignalEventRecord,
  SignalMatchRecord,
  ItemSourceRecord,
  LlmRunRecord,
  LlmRunType,
  NormalizedItemRecord,
  SavedDigestRecord,
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
  digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  send_reason TEXT,
  PRIMARY KEY (digest_id, item_id)
);

CREATE TABLE IF NOT EXISTS followup_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_number INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  context_json TEXT NOT NULL,
  UNIQUE(digest_id, item_number)
);

CREATE TABLE IF NOT EXISTS source_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  run_type TEXT NOT NULL,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  token_usage_json TEXT,
  error_text TEXT
);

CREATE TABLE IF NOT EXISTS item_enrichments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  digest_cache_key TEXT NOT NULL,
  digest_mode TEXT NOT NULL,
  llm_run_id INTEGER REFERENCES llm_runs(id) ON DELETE SET NULL,
  prompt_version TEXT NOT NULL,
  themes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(digest_cache_key, prompt_version)
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

CREATE INDEX IF NOT EXISTS idx_normalized_items_title_hash ON normalized_items(title_hash);
CREATE INDEX IF NOT EXISTS idx_normalized_items_last_seen ON normalized_items(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sent_items_item_sent_at ON sent_items(item_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_followup_context_digest_number ON followup_context(digest_id, item_number);
CREATE INDEX IF NOT EXISTS idx_item_enrichments_item_lookup ON item_enrichments(item_id, prompt_version, source_hash);
CREATE INDEX IF NOT EXISTS idx_digest_enrichments_lookup ON digest_enrichments(digest_cache_key, prompt_version);
CREATE INDEX IF NOT EXISTS idx_signal_events_linked_url ON signal_events(linked_url);
CREATE INDEX IF NOT EXISTS idx_signal_events_fetched_at ON signal_events(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_event_matches_item ON signal_event_matches(item_id, created_at DESC);
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
  }

  close(): void {
    this.db.close();
  }

  private applyMigrations(): void {
    this.ensureColumn("normalized_items", "primary_source_layer", "TEXT NOT NULL DEFAULT 'primary'");
    this.ensureColumn("item_sources", "source_layer", "TEXT NOT NULL DEFAULT 'primary'");
  }

  private ensureColumn(tableName: string, columnName: string, columnSql: string): void {
    const columns = this.db
      .prepare<unknown[], { name: string }>(`PRAGMA table_info(${tableName})`)
      .all();

    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
    }
  }

  startSourceRun(sourceId: string, startedAt: string): number {
    const result = this.db
      .prepare(
        `INSERT INTO source_runs (source_id, started_at, status)
         VALUES (?, ?, 'running')`
      )
      .run(sourceId, startedAt);
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

  listCandidateItems(minSeenAtIso: string): NormalizedItemRecord[] {
    const rows = this.db
      .prepare<unknown[], CandidateItemRow>(
        `SELECT
           ni.*,
           (SELECT MAX(si.sent_at) FROM sent_items si WHERE si.item_id = ni.id) AS last_sent_at,
           (SELECT COUNT(DISTINCT src.source_id) FROM item_sources src WHERE src.item_id = ni.id) AS cross_signal_count
         FROM normalized_items ni
         WHERE COALESCE(ni.published_at, ni.last_seen_at) >= ?
         ORDER BY COALESCE(ni.published_at, ni.last_seen_at) DESC`
      )
      .all(minSeenAtIso);

    return rows.map((row) => this.hydrateNormalizedItem(row));
  }

  saveDigest(result: DigestBuildResult, generatedAt: string): SavedDigestRecord {
    const inserted = this.db
      .prepare(
        `INSERT INTO digests (mode, generated_at, window_start, window_end, header, body_text, items_json, themes_json, stats_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
      `INSERT INTO sent_items (digest_id, item_id, slot, sent_at, send_reason)
       VALUES (?, ?, ?, ?, ?)`
    );
    const followupStatement = this.db.prepare(
      `INSERT INTO followup_context (digest_id, item_number, item_id, created_at, context_json)
       VALUES (?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((items: DigestEntry[]) => {
      items.forEach((item, index) => {
        sentStatement.run(digestId, item.itemId, index + 1, generatedAt, item.sectionKey);
        followupStatement.run(digestId, item.number, item.itemId, generatedAt, JSON.stringify(item));
      });
    });

    transaction(result.items);
    return this.getDigestById(digestId)!;
  }

  getLatestDigest(mode?: string): SavedDigestRecord | null {
    const row = mode
      ? this.db
          .prepare<unknown[], DigestRow>(
            `SELECT * FROM digests WHERE mode = ? ORDER BY generated_at DESC LIMIT 1`
          )
          .get(mode)
      : this.db
          .prepare<unknown[], DigestRow>(`SELECT * FROM digests ORDER BY generated_at DESC LIMIT 1`)
          .get();

    return row ? mapDigestRow(row) : null;
  }

  getDigestById(id: number): SavedDigestRecord | null {
    const row = this.db.prepare<unknown[], DigestRow>(`SELECT * FROM digests WHERE id = ?`).get(id);
    return row ? mapDigestRow(row) : null;
  }

  getFollowupContext(itemNumber: number, digestId?: number): DigestEntry | null {
    const targetDigestId = digestId ?? this.getLatestDigest()?.id;
    if (!targetDigestId) {
      return null;
    }

    const row = this.db
      .prepare<unknown[], { context_json: string }>(
        `SELECT context_json
         FROM followup_context
         WHERE digest_id = ? AND item_number = ?`
      )
      .get(targetDigestId, itemNumber);

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
    runType: LlmRunType;
    modelName: string;
    promptVersion: string;
    inputHash: string;
    startedAt: string;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO llm_runs (run_type, model_name, prompt_version, input_hash, started_at, status)
         VALUES (?, ?, ?, ?, ?, 'running')`
      )
      .run(input.runType, input.modelName, input.promptVersion, input.inputHash, input.startedAt);

    return Number(result.lastInsertRowid);
  }

  finishLlmRun(input: {
    runId: number;
    status: LlmRunRecord["status"];
    completedAt: string;
    latencyMs?: number | null;
    tokenUsage?: Record<string, unknown> | null;
    errorText?: string | null;
  }): void {
    this.db
      .prepare(
        `UPDATE llm_runs
         SET completed_at = ?, status = ?, latency_ms = ?, token_usage_json = ?, error_text = ?
         WHERE id = ?`
      )
      .run(
        input.completedAt,
        input.status,
        input.latencyMs ?? null,
        input.tokenUsage ? JSON.stringify(input.tokenUsage) : null,
        input.errorText ?? null,
        input.runId
      );
  }

  getItemEnrichment(itemId: number, promptVersion: string, sourceHash: string): ItemEnrichmentRecord | null {
    const row = this.db
      .prepare<unknown[], ItemEnrichmentRow>(
        `SELECT *
         FROM item_enrichments
         WHERE item_id = ? AND prompt_version = ? AND source_hash = ?
         LIMIT 1`
      )
      .get(itemId, promptVersion, sourceHash);

    return row ? mapItemEnrichmentRow(row) : null;
  }

  saveItemEnrichment(input: {
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
  }): ItemEnrichmentRecord {
    this.db
      .prepare(
        `INSERT INTO item_enrichments (
          item_id, llm_run_id, prompt_version, source_hash, summary_ko, why_important_ko,
          confidence, uncertainty_notes_json, theme_tags_json, officialness_note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id, prompt_version, source_hash)
        DO UPDATE SET
          llm_run_id = excluded.llm_run_id,
          summary_ko = excluded.summary_ko,
          why_important_ko = excluded.why_important_ko,
          confidence = excluded.confidence,
          uncertainty_notes_json = excluded.uncertainty_notes_json,
          theme_tags_json = excluded.theme_tags_json,
          officialness_note = excluded.officialness_note,
          created_at = excluded.created_at`
      )
      .run(
        input.itemId,
        input.llmRunId ?? null,
        input.promptVersion,
        input.sourceHash,
        input.summaryKo,
        input.whyImportantKo,
        input.confidence,
        JSON.stringify(input.uncertaintyNotes),
        JSON.stringify(input.themeTags),
        input.officialnessNote ?? null,
        input.createdAt
      );

    const saved = this.getItemEnrichment(input.itemId, input.promptVersion, input.sourceHash);
    if (!saved) {
      throw new Error(`Failed to load saved item enrichment for item ${input.itemId}`);
    }
    return saved;
  }

  getDigestThemeEnrichment(digestCacheKey: string, promptVersion: string): DigestThemeEnrichmentRecord | null {
    const row = this.db
      .prepare<unknown[], DigestEnrichmentRow>(
        `SELECT *
         FROM digest_enrichments
         WHERE digest_cache_key = ? AND prompt_version = ?
         LIMIT 1`
      )
      .get(digestCacheKey, promptVersion);

    return row ? mapDigestEnrichmentRow(row) : null;
  }

  saveDigestThemeEnrichment(input: {
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
          digest_cache_key, digest_mode, llm_run_id, prompt_version, themes_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(digest_cache_key, prompt_version)
        DO UPDATE SET
          digest_mode = excluded.digest_mode,
          llm_run_id = excluded.llm_run_id,
          themes_json = excluded.themes_json,
          created_at = excluded.created_at`
      )
      .run(
        input.digestCacheKey,
        input.digestMode,
        input.llmRunId ?? null,
        input.promptVersion,
        JSON.stringify(input.themes),
        input.createdAt
      );

    const saved = this.getDigestThemeEnrichment(input.digestCacheKey, input.promptVersion);
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
    itemId: row.item_id,
    llmRunId: row.llm_run_id,
    promptVersion: row.prompt_version,
    sourceHash: row.source_hash,
    summaryKo: row.summary_ko,
    whyImportantKo: row.why_important_ko,
    confidence: row.confidence,
    uncertaintyNotes: JSON.parse(row.uncertainty_notes_json),
    themeTags: JSON.parse(row.theme_tags_json),
    officialnessNote: row.officialness_note,
    createdAt: row.created_at
  };
}

function mapDigestEnrichmentRow(row: DigestEnrichmentRow): DigestThemeEnrichmentRecord {
  return {
    id: row.id,
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
  item_id: number;
  llm_run_id?: number | null;
  prompt_version: string;
  source_hash: string;
  summary_ko: string;
  why_important_ko: string;
  confidence: number;
  uncertainty_notes_json: string;
  theme_tags_json: string;
  officialness_note?: string | null;
  created_at: string;
}

interface DigestEnrichmentRow {
  id: number;
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

interface SignalMatchRow extends SignalEventRow {
  match_id: number;
  signal_event_id: number;
  item_id: number;
  match_type: string;
  boost_score: number;
}
