import type { DigestEntry, DigestMode } from "../types.js";

export function buildItemEnrichmentPrompts(input: { mode: DigestMode; items: DigestEntry[] }): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You are improving a Korean AI news digest for a single technical user.",
    "Use only the evidence supplied in the prompt.",
    "Do not invent facts, dates, rollout scope, benchmark results, or opinions not grounded in the provided evidence.",
    "Write Korean analysis, but preserve English product names, company names, repo names, API names, and model names exactly as written.",
    "Prefer official interpretations when the source is official.",
    "Avoid hype language and avoid generic claims like 'important for AI' or 'useful for developers' unless you explain the concrete mechanism.",
    "Engineer relevance must explain what changes for APIs, tooling, workflow, infra, evals, automation, or productization.",
    "Each field must add new information instead of paraphrasing the previous field.",
    "Name the changed interface, runtime boundary, workflow step, deployment gate, cost/latency envelope, or abstraction layer whenever the evidence supports it.",
    "Avoid stock phrases such as '생태계가 재정렬된다', '중요한 신호다', '촉진한다', or '보여준다' unless you also name the actor, mechanism, and practical consequence.",
    "Do not spend tokens repeating the title or source label. Spend them on the changed mechanism and downstream consequence.",
    "For openai_angle_ko, use null unless the evidence supports a broader OpenAI roadmap, product boundary, or resourcing implication that is not already stated elsewhere.",
    "Trend and cause/effect fields are allowed to be inferential, but they must stay tightly grounded in the supplied evidence.",
    "If evidence is thin, reflect that in uncertainty_notes instead of guessing.",
    "Return JSON only."
  ].join(" ");

  const itemsPayload = input.items.map((item) => {
    const articleContext = getEmbeddedArticleContext(item);
    return {
      item_id: item.itemId,
      title: item.title,
      section_key: item.sectionKey,
      deterministic_what_changed: item.whatChanged ?? item.summary,
      deterministic_engineer_relevance: item.engineerRelevance ?? item.whyImportant,
      deterministic_ai_ecosystem: item.aiEcosystem ?? "",
      deterministic_trend_signal: item.trendSignal ?? "",
      content_snippet: item.contentSnippet ?? item.description ?? "",
      description: item.description ?? "",
      source_label: item.sourceLabel,
      source_type: item.sourceType,
      item_kind: item.itemKind,
      openai_category: item.openaiCategory ?? null,
      repo_language: item.repoLanguage ?? null,
      repo_stars_today: item.repoStarsToday ?? null,
      repo_stars_total: item.repoStarsTotal ?? null,
      keywords: item.keywords,
      score_reasons: item.scoreReasons,
      primary_url: item.primaryUrl,
      source_links: item.sourceLinks,
      evidence_bundle: {
        headline: articleContext?.headline ?? item.title,
        dek: articleContext?.dek ?? item.description ?? null,
        publisher: articleContext?.publisher ?? item.sourceLabel,
        author: articleContext?.author ?? null,
        fetch_status: articleContext?.fetchStatus ?? "fallback",
        key_sections: articleContext?.keySections ?? [],
        evidence_snippets: articleContext?.evidenceSnippets ?? item.evidenceSpans ?? [],
        clean_text_excerpt: articleContext?.cleanText ? String(articleContext.cleanText).slice(0, 5000) : ""
      }
    };
  });

  const userPrompt = [
    `Digest mode: ${input.mode}`,
    "Analyze every item below.",
    "For each item, produce:",
    "- what_changed_ko: at most 2 Korean sentences, fact-first, describing the changed product/policy/runtime/repo behavior; do not just restate the title",
    "- engineer_relevance_ko: 1 to 2 Korean sentences naming one concrete engineering action, changed interface, or changed workflow layer",
    "- ai_ecosystem_ko: 1 Korean sentence explaining who in the ecosystem must respond or adapt, and to what concrete shift",
    "- openai_angle_ko: null unless there is a non-obvious OpenAI roadmap or product-boundary implication beyond the article summary",
    "- trend_signal_ko: 1 Korean sentence naming the stack layer or market direction that is changing; avoid empty umbrella phrases",
    "- cause_effect_ko: 1 Korean sentence connecting a present trigger to the most likely next effect",
    "- watchpoints_ko: 1 to 3 bullets for what to verify next",
    "- evidence_spans: 2 to 4 short snippets distilled from the supplied evidence bundle",
    "- novelty_score: 0 to 1",
    "- insight_score: 0 to 1",
    "- confidence: 0 to 1",
    "- uncertainty_notes: empty array if evidence is strong",
    "- theme_tags: up to 6 short English tags",
    "- officialness_note: classify the item",
    "Do not repeat the source label as the answer.",
    "Do not write filler about why AI matters unless it is tied to the concrete item.",
    "Bad pattern: '이 발표는 생태계 재정렬을 촉진합니다.'",
    "Good pattern: 'Hosted container runtime이 공식 API boundary 안으로 들어오면 agent framework가 바깥 wrapper 대신 permission, state, eval 레이어로 경쟁하게 됩니다.'",
    "",
    JSON.stringify(itemsPayload, null, 2)
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function getEmbeddedArticleContext(item: DigestEntry):
  | {
      headline?: string;
      dek?: string | null;
      publisher?: string | null;
      author?: string | null;
      fetchStatus?: string;
      keySections?: string[];
      evidenceSnippets?: string[];
      cleanText?: string;
    }
  | null {
  const metadata = item.metadata as Record<string, unknown>;
  const value = metadata.articleContext;
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as {
    headline?: string;
    dek?: string | null;
    publisher?: string | null;
    author?: string | null;
    fetchStatus?: string;
    keySections?: string[];
    evidenceSnippets?: string[];
    cleanText?: string;
  };
}

export function buildThemeSynthesisPrompts(input: { mode: DigestMode; items: DigestEntry[] }): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You synthesize themes across a small set of already selected AI news items.",
    "Use only the supplied digest items.",
    "Do not invent cross-item relationships unless they are directly supported by the provided summaries and evidence.",
    "Write concise Korean bullets, preserving English product and repo names.",
    "Avoid hype and avoid generic advice.",
    "Do not use vague industry-wide claims unless you name the layer that changed and why it matters now.",
    "Return JSON only."
  ].join(" ");

  const payload = input.items.map((item) => ({
    item_id: item.itemId,
    title: item.title,
    what_changed: item.whatChanged ?? item.summary,
    engineer_relevance: item.engineerRelevance ?? item.whyImportant,
    ai_ecosystem: item.aiEcosystem ?? "",
    trend_signal: item.trendSignal ?? "",
    cause_effect: item.causeEffect ?? "",
    section_key: item.sectionKey,
    source_label: item.sourceLabel,
    keywords: item.keywords,
    evidence_spans: item.evidenceSpans ?? [],
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
    what_changed: item.whatChanged ?? item.summary,
    engineer_relevance: item.engineerRelevance ?? item.whyImportant,
    ai_ecosystem: item.aiEcosystem ?? "",
    openai_angle: item.openAiAngle ?? null,
    trend_signal: item.trendSignal ?? "",
    cause_effect: item.causeEffect ?? "",
    watchpoints: item.watchpoints ?? [],
    source_label: item.sourceLabel,
    score_reasons: item.scoreReasons,
    keywords: item.keywords,
    source_links: item.sourceLinks,
    evidence_spans: item.evidenceSpans ?? []
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
    what_changed: item.whatChanged ?? item.summary,
    engineer_relevance: item.engineerRelevance ?? item.whyImportant,
    ai_ecosystem: item.aiEcosystem ?? "",
    openai_angle: item.openAiAngle ?? null,
    trend_signal: item.trendSignal ?? "",
    cause_effect: item.causeEffect ?? "",
    watchpoints: item.watchpoints ?? [],
    source_label: item.sourceLabel,
    score_reasons: item.scoreReasons,
    source_links: item.sourceLinks,
    evidence_spans: item.evidenceSpans ?? []
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
