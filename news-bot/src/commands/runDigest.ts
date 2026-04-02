import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { buildDigest } from "../digest/buildDigest.js";
import { maybeEnrichDigest } from "../llm/enrichDigest.js";
import { collectAndStoreSources } from "../sources/index.js";
import type { DigestBuildResult, SourceItemInput } from "../types.js";

export interface RunDigestOptions {
  mode: "am" | "pm" | "manual";
  nowIso?: string;
  dbPathOverride?: string;
  skipFetch?: boolean;
  fixturePath?: string;
  resetDb?: boolean;
}

export async function runDigestFlow(options: RunDigestOptions): Promise<{
  config: AppConfig;
  digest: DigestBuildResult;
  db: NewsDatabase;
}> {
  const config = loadConfig(process.cwd());
  const dbPath = options.dbPathOverride ? path.resolve(process.cwd(), options.dbPathOverride) : config.dbPath;

  if (options.resetDb && dbPath !== ":memory:" && fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }

  const db = new NewsDatabase(dbPath);
  const now = options.nowIso
    ? DateTime.fromISO(options.nowIso, { zone: config.timezone }).setZone(config.timezone)
    : DateTime.now().setZone(config.timezone);

  if (options.fixturePath) {
    seedFixtureItems(db, options.fixturePath, now);
  }

  if (!options.skipFetch) {
    await collectAndStoreSources(db, config, now);
  }

  const digest = buildDigest({
    db,
    config,
    mode: options.mode,
    now
  });

  await maybeEnrichDigest({
    db,
    config,
    digest,
    now
  });

  db.saveDigest(digest, now.toUTC().toISO() ?? new Date().toISOString());
  return { config, digest, db };
}

export async function runFetchOnly(options: {
  nowIso?: string;
  dbPathOverride?: string;
  resetDb?: boolean;
}): Promise<{ config: AppConfig; db: NewsDatabase }> {
  const config = loadConfig(process.cwd());
  const dbPath = options.dbPathOverride ? path.resolve(process.cwd(), options.dbPathOverride) : config.dbPath;
  if (options.resetDb && dbPath !== ":memory:" && fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }

  const db = new NewsDatabase(dbPath);
  const now = options.nowIso
    ? DateTime.fromISO(options.nowIso, { zone: config.timezone }).setZone(config.timezone)
    : DateTime.now().setZone(config.timezone);

  await collectAndStoreSources(db, config, now);
  return { config, db };
}

function seedFixtureItems(db: NewsDatabase, fixturePath: string, now: DateTime): void {
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const items = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as SourceItemInput[];

  for (const item of items) {
    db.upsertNormalizedItem({
      ...item,
      fetchedAt: item.fetchedAt ?? now.toUTC().toISO() ?? new Date().toISOString()
    });
  }
}
