import type { DigestEntry, DigestMode } from "../types.js";

export function buildItemEnrichmentPrompts(input: { mode: DigestMode; items: DigestEntry[] }): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You are improving a Korean AI news digest for a single technical user.",
    "Use only the evidence supplied in the prompt.",
    "Do not invent facts, dates, rollout scope, benchmark results, or opinions not grounded in the provided evidence.",
    "Write concise Korean summary text, but preserve English product names, company names, repo names, API names, and model names exactly as written.",
    "Prefer official interpretations when the source is official.",
    "Avoid hype language.",
    "If evidence is thin, reflect that in uncertainty_notes instead of guessing.",
    "Return JSON only."
  ].join(" ");

  const itemsPayload = input.items.map((item) => ({
    item_id: item.itemId,
    title: item.title,
    section_key: item.sectionKey,
    current_summary: item.summary,
    current_why_important: item.whyImportant,
    content_snippet: item.contentSnippet ?? item.description ?? "",
    description: item.description ?? "",
    source_label: item.sourceLabel,
    openai_category: item.openaiCategory ?? null,
    repo_language: item.repoLanguage ?? null,
    repo_stars_today: item.repoStarsToday ?? null,
    keywords: item.keywords,
    score_reasons: item.scoreReasons,
    primary_url: item.primaryUrl,
    source_links: item.sourceLinks
  }));

  const userPrompt = [
    `Digest mode: ${input.mode}`,
    "Enrich every item below.",
    "For each item, produce:",
    "- summary_ko: one concise Korean sentence",
    "- why_important_ko: one concise Korean sentence tailored to a user who cares about OpenAI, agents, MCP, browser automation, evals, devtools, and meaningful repos",
    "- confidence: 0 to 1",
    "- uncertainty_notes: empty array if evidence is strong",
    "- theme_tags: up to 6 short English tags",
    "- officialness_note: classify the item",
    "",
    JSON.stringify(itemsPayload, null, 2)
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function buildThemeSynthesisPrompts(input: { mode: DigestMode; items: DigestEntry[] }): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You synthesize themes across a small set of already selected AI news items.",
    "Use only the supplied digest items.",
    "Do not invent cross-item relationships unless they are directly supported by the provided summaries and score reasons.",
    "Write concise Korean bullets, preserving English product and repo names.",
    "Avoid hype and avoid generic advice.",
    "Return JSON only."
  ].join(" ");

  const payload = input.items.map((item) => ({
    item_id: item.itemId,
    title: item.title,
    summary: item.summary,
    why_important: item.whyImportant,
    section_key: item.sectionKey,
    source_label: item.sourceLabel,
    keywords: item.keywords,
    score_reasons: item.scoreReasons,
    openai_category: item.openaiCategory ?? null,
    repo_language: item.repoLanguage ?? null,
    repo_stars_today: item.repoStarsToday ?? null
  }));

  const bulletCount = input.mode === "am" ? "1 to 2" : "2 to 4";
  const userPrompt = [
    `Digest mode: ${input.mode}`,
    `Return ${bulletCount} Korean theme bullets for the digest.`,
    "Focus on practical patterns, methodology shifts, or ecosystem direction that the user should notice.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");

  return { systemPrompt, userPrompt };
}
