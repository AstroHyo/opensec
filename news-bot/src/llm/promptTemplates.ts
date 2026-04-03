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

export function buildFollowupAnswerPrompts(input: {
  question: string;
  items: DigestEntry[];
  themes: string[];
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You answer follow-up questions about an already curated Korean AI news digest for a single technical user.",
    "Use only the digest items and themes supplied in the prompt.",
    "Do not browse, do not invent facts, and do not claim evidence outside the provided bundle.",
    "Write concise Korean, but preserve English product names, company names, repo names, API names, and model names exactly as written.",
    "When the user asks for implications, ground them in the supplied score reasons and source labels.",
    "Return JSON only."
  ].join(" ");

  const payload = input.items.map((item) => ({
    item_number: item.number,
    title: item.title,
    summary: item.summary,
    why_important: item.whyImportant,
    source_label: item.sourceLabel,
    score_reasons: item.scoreReasons,
    keywords: item.keywords,
    source_links: item.sourceLinks
  }));

  const userPrompt = [
    `User question: ${input.question}`,
    "Answer using only the provided digest evidence.",
    "Return:",
    "- answer_ko: a concise Korean answer",
    "- bullets_ko: up to 4 short supporting bullets",
    "- used_item_numbers: the item numbers you relied on",
    "- uncertainty_notes: empty array if confidence is high",
    "",
    `Digest themes: ${input.themes.length > 0 ? input.themes.join(" | ") : "none"}`,
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function buildResearchAnswerPrompts(input: {
  question: string;
  items: DigestEntry[];
  themes: string[];
}): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You answer a post-digest research question for a single technical user.",
    "You may use web search, but only to deepen understanding of the digest items supplied in the prompt.",
    "Prefer official and primary sources over commentary when possible.",
    "If the evidence is mixed or incomplete, say so clearly.",
    "Write concise Korean, but preserve English product names, company names, repo names, API names, and model names exactly as written.",
    "Only include source URLs you actually used from the search results.",
    "Return JSON only."
  ].join(" ");

  const payload = input.items.map((item) => ({
    item_number: item.number,
    title: item.title,
    summary: item.summary,
    why_important: item.whyImportant,
    source_label: item.sourceLabel,
    score_reasons: item.scoreReasons,
    source_links: item.sourceLinks
  }));

  const userPrompt = [
    `User question: ${input.question}`,
    "Start from the digest items below, then use live search only to deepen or update the answer.",
    "Return:",
    "- answer_ko: a concise Korean conclusion",
    "- bullets_ko: up to 5 factual findings",
    "- implications_ko: up to 3 practical implications for the user",
    "- uncertainty_notes: empty array if evidence is strong",
    "- used_item_numbers: item numbers you relied on",
    "- sources: up to 6 web sources actually used",
    "",
    `Digest themes: ${input.themes.length > 0 ? input.themes.join(" | ") : "none"}`,
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");

  return { systemPrompt, userPrompt };
}
