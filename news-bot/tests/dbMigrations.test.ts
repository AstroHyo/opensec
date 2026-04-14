import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { NewsDatabase } from "../src/db.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("database migrations", () => {
  it("adds profile_key columns before creating profile-scoped indexes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opensec-newsbot-legacy-"));
    tempDirs.push(dir);

    const dbPath = path.join(dir, "legacy.sqlite");
    const legacyDb = new Database(dbPath);

    legacyDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE digests (
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

      CREATE TABLE sent_items (
        digest_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        sent_at TEXT NOT NULL,
        send_reason TEXT,
        PRIMARY KEY (digest_id, item_id)
      );

      CREATE TABLE followup_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        digest_id INTEGER NOT NULL,
        item_number INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        context_json TEXT NOT NULL,
        UNIQUE(digest_id, item_number)
      );

      CREATE TABLE source_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL,
        items_fetched INTEGER DEFAULT 0,
        items_normalized INTEGER DEFAULT 0,
        error_text TEXT
      );

      CREATE TABLE llm_runs (
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

      CREATE TABLE item_enrichments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        llm_run_id INTEGER,
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

      CREATE TABLE digest_enrichments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        digest_cache_key TEXT NOT NULL,
        digest_mode TEXT NOT NULL,
        llm_run_id INTEGER,
        prompt_version TEXT NOT NULL,
        themes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(digest_cache_key, prompt_version)
      );
    `);

    legacyDb.close();

    const migratedDb = new NewsDatabase(dbPath);
    migratedDb.close();

    const verificationDb = new Database(dbPath, { readonly: true });

    try {
      for (const tableName of [
        "digests",
        "sent_items",
        "followup_context",
        "source_runs",
        "llm_runs",
        "item_enrichments",
        "digest_enrichments"
      ]) {
        const columns = verificationDb
          .prepare<unknown[], { name: string }>(`PRAGMA table_info(${tableName})`)
          .all()
          .map((column) => column.name);

        expect(columns).toContain("profile_key");
      }

      const tableNames = verificationDb
        .prepare<unknown[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all()
        .map((row) => row.name);

      expect(tableNames).toContain("housing_watch_runs");
      expect(tableNames).toContain("housing_watch_candidates");
      expect(tableNames).toContain("housing_watch_notifications");
      expect(tableNames).toContain("article_contexts");

      const enrichmentColumns = verificationDb
        .prepare<unknown[], { name: string }>("PRAGMA table_info(item_enrichments)")
        .all()
        .map((column) => column.name);

      expect(enrichmentColumns).toContain("what_changed_ko");
      expect(enrichmentColumns).toContain("engineer_relevance_ko");
      expect(enrichmentColumns).toContain("ai_ecosystem_ko");
      expect(enrichmentColumns).toContain("openai_angle_ko");
      expect(enrichmentColumns).toContain("trend_signal_ko");
      expect(enrichmentColumns).toContain("cause_effect_ko");
      expect(enrichmentColumns).toContain("watchpoints_json");
      expect(enrichmentColumns).toContain("evidence_spans_json");
      expect(enrichmentColumns).toContain("novelty_score");
      expect(enrichmentColumns).toContain("insight_score");
    } finally {
      verificationDb.close();
    }
  });
});
