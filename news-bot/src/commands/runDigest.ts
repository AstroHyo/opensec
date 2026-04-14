import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { buildDigest } from "../digest/buildDigest.js";
import { embedArticleContexts, ensureArticleContexts } from "../evidence/articleContext.js";
import { maybeEnrichDigest } from "../llm/enrichDigest.js";
import { PROFILE_KEYS } from "../profiles.js";
import { collectAndStoreSources } from "../sources/index.js";
import type { DigestBuildResult, ProfileKey, SourceItemInput } from "../types.js";

export interface RunDigestOptions {
  profileKey?: ProfileKey;
  mode: "am" | "pm" | "manual";
  nowIso?: string;
  dbPathOverride?: string;
  skipFetch?: boolean;
  fixturePath?: string;
  resetDb?: boolean;
}

export async function runDigestFlow(options: RunDigestOptions): Promise<{
  config: AppConfig;
  profileKey: ProfileKey;
  digest: DigestBuildResult;
  db: NewsDatabase;
}> {
  const config = loadConfig(process.cwd());
  const profileKey = options.profileKey ?? config.defaultProfile;
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
    await collectAndStoreSources(db, config, now, profileKey);
  }

  const digest = buildDigest({
    db,
    config,
    profileKey,
    mode: options.mode,
    now
  });

  const evidenceTargetItems = digest.candidateEntries ?? digest.items;
  if (evidenceTargetItems.length > 0) {
    const contexts = await ensureArticleContexts({
      db,
      config,
      items: evidenceTargetItems,
      fetchedAt: now.toUTC().toISO() ?? new Date().toISOString()
    });
    embedArticleContexts(evidenceTargetItems, contexts);
    embedArticleContexts(digest.items, contexts);
  }

  await maybeEnrichDigest({
    db,
    config,
    digest,
    now
  });

  db.saveDigest(profileKey, digest, now.toUTC().toISO() ?? new Date().toISOString());
  return { config, profileKey, digest, db };
}

export async function runFetchOnly(options: {
  profileKey?: ProfileKey;
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

  if (options.profileKey) {
    await collectAndStoreSources(db, config, now, options.profileKey);
  } else {
    for (const [index, profileKey] of PROFILE_KEYS.entries()) {
      await collectAndStoreSources(db, config, now, profileKey, { includeEarlyWarning: index === 0 });
    }
  }
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
