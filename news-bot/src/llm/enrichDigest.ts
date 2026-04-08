import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import type { DigestBuildResult, DigestEntry, ItemEnrichmentRecord } from "../types.js";
import { sha256Hex } from "../util/canonicalize.js";
import { collapseWhitespace, truncate } from "../util/text.js";
import { renderTelegramDigest } from "../digest/renderTelegram.js";
import { generateStructuredJson } from "./openaiClient.js";
import { buildItemEnrichmentPrompts, buildThemeSynthesisPrompts } from "./promptTemplates.js";
import {
  digestThemeJsonSchema,
  digestThemeSchema,
  itemEnrichmentBatchSchema,
  itemEnrichmentJsonSchema,
  ITEM_ENRICHMENT_PROMPT_VERSION,
  THEME_SYNTHESIS_PROMPT_VERSION
} from "./schemas.js";

export async function maybeEnrichDigest(input: {
  db: NewsDatabase;
  config: AppConfig;
  digest: DigestBuildResult;
  now: DateTime;
}): Promise<void> {
  const apiKey = input.config.openAiApiKey;
  if (!input.config.llm.enabled || !apiKey) {
    return;
  }

  const maxItems = input.digest.mode === "am" ? input.config.llm.maxItemsAm : input.config.llm.maxItemsPm;
  const targetItems = input.digest.items.slice(0, maxItems);

  if (targetItems.length > 0) {
    await enrichItems(input.db, input.config, apiKey, targetItems, input.digest.mode, input.now);
  }

  if (input.config.llm.themesEnabled && input.digest.items.length > 0) {
    await enrichThemes(input.db, input.config, apiKey, input.digest, input.now);
  }

  input.digest.bodyText = renderTelegramDigest(input.digest);
}

async function enrichItems(
  db: NewsDatabase,
  config: AppConfig,
  apiKey: string,
  items: DigestEntry[],
  mode: DigestBuildResult["mode"],
  now: DateTime
): Promise<void> {
  const missing: DigestEntry[] = [];

  for (const item of items) {
    const sourceHash = buildItemSourceHash(item);
    const record = db.getItemEnrichment(item.profileKey, item.itemId, ITEM_ENRICHMENT_PROMPT_VERSION, sourceHash);
    if (record) {
      applyItemEnrichment(item, record);
    } else {
      missing.push(item);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const inputHash = sha256Hex(
    JSON.stringify(
      missing.map((item) => ({
        itemId: item.itemId,
        sourceHash: buildItemSourceHash(item)
      }))
    )
  );
  const startedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const startedMillis = Date.now();
  const runId = db.startLlmRun({
    profileKey: items[0]?.profileKey ?? "tech",
    runType: "item_enrichment",
    modelName: config.llm.summaryModel,
    promptVersion: ITEM_ENRICHMENT_PROMPT_VERSION,
    inputHash,
    startedAt
  });

  try {
    const prompts = buildItemEnrichmentPrompts({ mode, items: missing });
    const response = await generateStructuredJson({
      apiKey,
      model: config.llm.summaryModel,
      schemaName: "item_enrichment_batch",
      schema: itemEnrichmentJsonSchema,
      validator: itemEnrichmentBatchSchema,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      timeoutMs: config.llm.timeoutMs
    });

    const byId = new Map(response.data.items.map((item) => [item.item_id, item] as const));
    let savedCount = 0;

    for (const item of missing) {
      const enrichment = byId.get(item.itemId);
      if (!enrichment) {
        continue;
      }

      const saved = db.saveItemEnrichment({
        profileKey: item.profileKey,
        itemId: item.itemId,
        llmRunId: runId,
        promptVersion: ITEM_ENRICHMENT_PROMPT_VERSION,
        sourceHash: buildItemSourceHash(item),
        summaryKo: truncate(collapseWhitespace(enrichment.summary_ko), 180),
        whyImportantKo: truncate(collapseWhitespace(enrichment.why_important_ko), 160),
        confidence: enrichment.confidence,
        uncertaintyNotes: enrichment.uncertainty_notes.map((value) => truncate(collapseWhitespace(value), 120)),
        themeTags: enrichment.theme_tags.map((value) => truncate(collapseWhitespace(value), 32)),
        officialnessNote: enrichment.officialness_note,
        createdAt: now.toUTC().toISO() ?? new Date().toISOString()
      });
      applyItemEnrichment(item, saved);
      savedCount += 1;
    }

    db.finishLlmRun({
      runId,
      status: savedCount === missing.length ? "ok" : "partial",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      tokenUsage: response.usage ?? null,
      errorText: savedCount === missing.length ? null : `Only enriched ${savedCount}/${missing.length} items`
    });
  } catch (error) {
    db.finishLlmRun({
      runId,
      status: "error",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

async function enrichThemes(
  db: NewsDatabase,
  config: AppConfig,
  apiKey: string,
  digest: DigestBuildResult,
  now: DateTime
): Promise<void> {
  const digestCacheKey = buildDigestThemeCacheKey(digest);
  const cached = db.getDigestThemeEnrichment(digest.profileKey, digestCacheKey, THEME_SYNTHESIS_PROMPT_VERSION);
  if (cached) {
    digest.themes = cached.themes;
    applyThemeBullets(digest);
    return;
  }

  const startedAt = now.toUTC().toISO() ?? new Date().toISOString();
  const startedMillis = Date.now();
  const runId = db.startLlmRun({
    profileKey: digest.profileKey,
    runType: "theme_synthesis",
    modelName: config.llm.themesModel,
    promptVersion: THEME_SYNTHESIS_PROMPT_VERSION,
    inputHash: digestCacheKey,
    startedAt
  });

  try {
    const prompts = buildThemeSynthesisPrompts({ mode: digest.mode, items: digest.items });
    const response = await generateStructuredJson({
      apiKey,
      model: config.llm.themesModel,
      schemaName: "digest_theme_synthesis",
      schema: digestThemeJsonSchema,
      validator: digestThemeSchema,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      timeoutMs: config.llm.timeoutMs
    });

    const themes = response.data.themes_ko
      .map((value) => truncate(collapseWhitespace(value), 160))
      .filter((value) => value.length > 0)
      .slice(0, digest.mode === "am" ? 2 : 4);

    if (themes.length > 0) {
      db.saveDigestThemeEnrichment({
        profileKey: digest.profileKey,
        digestCacheKey,
        digestMode: digest.mode,
        llmRunId: runId,
        promptVersion: THEME_SYNTHESIS_PROMPT_VERSION,
        themes,
        createdAt: now.toUTC().toISO() ?? new Date().toISOString()
      });
      digest.themes = themes;
      applyThemeBullets(digest);
    }

    db.finishLlmRun({
      runId,
      status: themes.length > 0 ? "ok" : "partial",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      tokenUsage: response.usage ?? null,
      errorText: themes.length > 0 ? null : "Model returned no usable theme bullets"
    });
  } catch (error) {
    db.finishLlmRun({
      runId,
      status: "error",
      completedAt: now.toUTC().toISO() ?? new Date().toISOString(),
      latencyMs: Date.now() - startedMillis,
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

export function buildItemSourceHash(item: DigestEntry): string {
  return sha256Hex(
    JSON.stringify({
      itemId: item.itemId,
      profileKey: item.profileKey,
      title: item.title,
      summary: item.summary,
      whyImportant: item.whyImportant,
      contentSnippet: item.contentSnippet ?? null,
      description: item.description ?? null,
      keywords: item.keywords,
      scoreReasons: item.scoreReasons,
      sourceLinks: item.sourceLinks,
      openaiCategory: item.openaiCategory ?? null,
      repoLanguage: item.repoLanguage ?? null,
      repoStarsToday: item.repoStarsToday ?? null
    })
  );
}

export function buildDigestThemeCacheKey(digest: DigestBuildResult): string {
  return sha256Hex(
    JSON.stringify({
      profileKey: digest.profileKey,
      mode: digest.mode,
      items: digest.items.map((item) => ({
        itemId: item.itemId,
        title: item.title,
        summary: item.summary,
        whyImportant: item.whyImportant,
        keywords: item.keywords,
        scoreReasons: item.scoreReasons
      }))
    })
  );
}

export function applyItemEnrichment(item: DigestEntry, enrichment: ItemEnrichmentRecord): void {
  item.summary = enrichment.summaryKo;
  item.whyImportant = enrichment.whyImportantKo;
  item.wasLlmEnriched = true;
  item.enrichmentConfidence = enrichment.confidence;
  item.uncertaintyNotes = enrichment.uncertaintyNotes;
  item.themeTags = enrichment.themeTags;
  item.officialnessNote = enrichment.officialnessNote ?? null;
}

function applyThemeBullets(digest: DigestBuildResult): void {
  const targetKey = digest.mode === "pm" ? "what_this_means" : "themes";
  const section = digest.sections.find((candidate) => candidate.key === targetKey);
  if (!section) {
    return;
  }
  section.bullets = digest.themes;
}
