import type { DigestEntry, DigestMode } from "../types.js";

export function buildItemEnrichmentPrompts(input: { mode: DigestMode; items: DigestEntry[] }): {
  systemPrompt: string;
  userPrompt: string;
} {
  const financeProfile = hasFinanceItems(input.items);
  const systemPrompt = financeProfile
    ? [
        "You are improving a Korean finance and market brief for a single sophisticated user.",
        "Use only the evidence supplied in the prompt.",
        "Do not invent facts, dates, rate paths, market reactions, funding scope, or opinions not grounded in the provided evidence.",
        "Write every narrative sentence in Korean.",
        "English is allowed only for proper nouns and market terms such as company names, product names, tickers, repo names, API names, model names, UST, USD, IG credit, NVDA, or SOX.",
        "Do not output whole English sentences or English clause chains.",
        "Prefer official interpretations when the source is official, but do not confuse officialness with market relevance.",
        "Avoid generic macro filler such as '거시/정책 방향을 읽는 데 중요하다', '시장 기대 변화와 같이 봐야 한다', or 'headline보다 맥락이 중요하다' unless you name the actual transmission path.",
        "For finance items, engineer_relevance_ko means market transmission path: rates, liquidity, credit, regulation burden, capital access, earnings guidance, capex, or funding conditions.",
        "For finance items, ai_ecosystem_ko means affected assets, sectors, or AI capital chain read-through, not vague AI ecosystem commentary.",
        "For openai_angle_ko, use null unless the evidence supports a concrete OpenAI financing, capex, competitive capital allocation, or ecosystem funding implication.",
        "repo_use_case_ko must be null for finance items.",
        "Each field must add new information instead of paraphrasing the previous field.",
        "Name the changed disclosure, policy lever, financing mechanism, repricing trigger, sector exposure, or capital cycle whenever the evidence supports it.",
        "If evidence is thin, reflect that in uncertainty_notes instead of guessing.",
        "Return JSON only."
      ].join(" ")
    : [
        "You are improving a Korean AI news digest for a single technical user.",
        "Use only the evidence supplied in the prompt.",
        "Do not invent facts, dates, rollout scope, benchmark results, or opinions not grounded in the provided evidence.",
        "Write every narrative sentence in Korean.",
        "English is allowed only for proper nouns and technical names such as product names, company names, repo names, API names, model names, CLI commands, protocol names, and short stack labels.",
        "Do not output whole English sentences or English clause chains. If a source snippet is in English, translate the sentence into Korean and keep only the product or repo names in English.",
        "Prefer official interpretations when the source is official.",
        "Avoid hype language and avoid generic claims like 'important for AI' or 'useful for developers' unless you explain the concrete mechanism.",
        "Engineer relevance must explain what changes for APIs, tooling, workflow, infra, evals, automation, or productization.",
        "Each field must add new information instead of paraphrasing the previous field.",
        "Name the changed interface, runtime boundary, workflow step, deployment gate, cost/latency envelope, or abstraction layer whenever the evidence supports it.",
        "Avoid stock phrases such as '생태계가 재정렬된다', '중요한 신호다', '촉진한다', or '보여준다' unless you also name the actor, mechanism, and practical consequence.",
        "Do not spend tokens repeating the title or source label. Spend them on the changed mechanism and downstream consequence.",
        "For openai_angle_ko, use null unless the evidence supports a broader OpenAI roadmap, product boundary, or resourcing implication that is not already stated elsewhere.",
        "For repo_use_case_ko, fill it only for repo items. Explain how a single-user automation stack like OpenSec/OpenClaw could try this repo, where it would plug into the stack, and what operational benefit it could unlock.",
        "Trend and cause/effect fields are allowed to be inferential, but they must stay tightly grounded in the supplied evidence.",
        "If evidence is thin, reflect that in uncertainty_notes instead of guessing.",
        "Return JSON only."
      ].join(" ");

  const itemsPayload = input.items.map((item) => {
    const articleContext = getEmbeddedArticleContext(item);
    return {
      item_id: item.itemId,
      profile_key: item.profileKey,
      title: item.title,
      section_key: item.sectionKey,
      deterministic_what_changed: item.whatChanged ?? item.summary,
      deterministic_engineer_relevance: item.engineerRelevance ?? item.whyImportant,
      deterministic_ai_ecosystem: item.aiEcosystem ?? "",
      deterministic_market_transmission: item.marketTransmission ?? null,
      deterministic_affected_assets: item.affectedAssets ?? null,
      deterministic_why_now: item.whyNow ?? null,
      deterministic_company_angle: item.companyAngle ?? null,
      deterministic_ai_capital_angle: item.aiCapitalAngle ?? null,
      deterministic_trend_signal: item.trendSignal ?? "",
      content_snippet: item.contentSnippet ?? item.description ?? "",
      description: item.description ?? "",
      source_label: item.sourceLabel,
      source_type: item.sourceType,
      item_kind: item.itemKind,
      openai_category: item.openaiCategory ?? null,
      repo_owner: item.title.includes("/") ? item.title.split("/")[0] : null,
      repo_name: item.repoStarsToday != null && item.title.includes("/") ? item.title.split("/")[1] : null,
      repo_language: item.repoLanguage ?? null,
      repo_stars_today: item.repoStarsToday ?? null,
      repo_stars_total: item.repoStarsTotal ?? null,
      finance_bucket: item.metadata.financeBucket ?? null,
      market_impact_level: item.metadata.marketImpactLevel ?? null,
      transmission_channels: item.metadata.transmissionChannels ?? null,
      affected_assets_metadata: item.metadata.affectedAssets ?? null,
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

  const userPrompt = financeProfile
    ? [
        `Digest mode: ${input.mode}`,
        "Analyze every finance item below.",
        "For each item, produce:",
        "- what_changed_ko: at most 2 Korean sentences explaining the new disclosure, policy, funding, capex, or market-structure change; do not just restate the title",
        "- engineer_relevance_ko: 1 to 2 Korean sentences naming the transmission path into rates, liquidity, credit, valuation, sector earnings, financing, or market structure",
        "- ai_ecosystem_ko: 1 Korean sentence naming the affected assets, sectors, or AI capital chain; if AI is not relevant, stay with sectors/assets and do not force AI commentary",
        "- openai_angle_ko: null unless there is a concrete OpenAI, hyperscaler, GPU, or AI capital allocation angle supported by the evidence",
        "- repo_use_case_ko: null",
        "- trend_signal_ko: 1 Korean sentence explaining why this matters now and what setup is changing",
        "- cause_effect_ko: 1 Korean sentence describing the most likely next effect, repricing path, or thing to monitor next",
        "- watchpoints_ko: 1 to 3 bullets for what to verify next",
        "- evidence_spans: 2 to 4 short snippets distilled from the supplied evidence bundle",
        "- novelty_score: 0 to 1",
        "- insight_score: 0 to 1",
        "- confidence: 0 to 1",
        "- uncertainty_notes: empty array if evidence is strong",
        "- theme_tags: up to 6 short English tags",
        "- officialness_note: classify the item",
        "Do not repeat the source label as the answer.",
        "Do not use empty market boilerplate.",
        "Bad pattern: '거시/정책 방향을 읽는 데 직접 쓰이는 공식 항목입니다.'",
        "Bad pattern: '시장 기대 변화와 같이 봐야 합니다.'",
        "Good pattern: 'Treasury funding 조달 압박이 커지면 bank reserve와 short-end funding cost 해석이 바뀌고, 그 영향이 USD와 bank-sensitive equities로 번질 수 있습니다.'",
        "",
        JSON.stringify(itemsPayload, null, 2)
      ].join("\n")
    : [
        `Digest mode: ${input.mode}`,
        "Analyze every item below.",
        "For each item, produce:",
        "- what_changed_ko: at most 2 Korean sentences, fact-first, describing the changed product/policy/runtime/repo behavior; do not just restate the title",
        "- engineer_relevance_ko: 1 to 2 Korean sentences naming one concrete engineering action, changed interface, or changed workflow layer",
        "- ai_ecosystem_ko: 1 Korean sentence explaining who in the ecosystem must respond or adapt, and to what concrete shift",
        "- openai_angle_ko: null unless there is a non-obvious OpenAI roadmap or product-boundary implication beyond the article summary",
        "- repo_use_case_ko: null for non-repo items; for repo items, 1 Korean sentence explaining how this could be used in a stack like OpenSec/OpenClaw and what concrete effect it would have",
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
        "Bad pattern: 'I have been running Claude Code and Codex together every day.'",
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
  const financeProfile = hasFinanceItems(input.items);
  const systemPrompt = financeProfile
    ? [
        "You synthesize themes across a small set of already selected finance and market brief items.",
        "Use only the supplied digest items.",
        "Do not invent cross-item relationships unless they are directly supported by the provided summaries and evidence.",
        "Write concise Korean bullets, preserving English company names, tickers, and market terms.",
        "Do not output whole English sentences.",
        "Avoid generic macro phrasing such as '시장 기대 변화' unless you name the actual asset, sector, or transmission path.",
        "Name what changed in rates, liquidity, regulation burden, funding, capital expenditure, or AI capital chain when supported.",
        "Return JSON only."
      ].join(" ")
    : [
        "You synthesize themes across a small set of already selected AI news items.",
        "Use only the supplied digest items.",
        "Do not invent cross-item relationships unless they are directly supported by the provided summaries and evidence.",
        "Write concise Korean bullets, preserving English product and repo names.",
        "Do not output whole English sentences. Translate source wording into Korean and keep only proper nouns in English.",
        "Avoid hype and avoid generic advice.",
        "Do not use vague industry-wide claims unless you name the layer that changed and why it matters now.",
        "Return JSON only."
      ].join(" ");

  const payload = input.items.map((item) => ({
    item_id: item.itemId,
    profile_key: item.profileKey,
    title: item.title,
    what_changed: item.whatChanged ?? item.summary,
    engineer_relevance: item.engineerRelevance ?? item.whyImportant,
    ai_ecosystem: item.aiEcosystem ?? "",
    market_transmission: item.marketTransmission ?? null,
    affected_assets: item.affectedAssets ?? null,
    why_now: item.whyNow ?? null,
    company_angle: item.companyAngle ?? null,
    ai_capital_angle: item.aiCapitalAngle ?? null,
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
  const userPrompt = financeProfile
    ? [
        `Digest mode: ${input.mode}`,
        `Return ${bulletCount} Korean theme bullets for the finance digest.`,
        "Focus on repricing drivers, transmission channels, policy/capital mechanisms, and AI capex or funding read-through when supported.",
        "Each bullet should name the changed setup, affected assets or sectors, and why the user should care now.",
        "",
        JSON.stringify(payload, null, 2)
      ].join("\n")
    : [
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
  const financeProfile = hasFinanceItems(input.items);
  const systemPrompt = financeProfile
    ? [
        "You answer follow-up questions about an already curated Korean finance and market brief for a single sophisticated user.",
        "Use only the digest items and themes supplied in the prompt.",
        "Do not browse, do not invent facts, and do not claim evidence outside the provided bundle.",
        "Write every sentence in Korean, while preserving English company names, tickers, repo names, product names, and market terms exactly as written.",
        "Do not output whole English sentences or English clause chains.",
        "When the user asks for implications, ground them in market transmission, affected assets, financing paths, or disclosed policy mechanisms.",
        "Return JSON only."
      ].join(" ")
    : [
        "You answer follow-up questions about an already curated Korean AI news digest for a single technical user.",
        "Use only the digest items and themes supplied in the prompt.",
        "Do not browse, do not invent facts, and do not claim evidence outside the provided bundle.",
        "Write every sentence in Korean, while preserving English product names, company names, repo names, API names, and model names exactly as written.",
        "Do not output whole English sentences or English clause chains.",
        "When the user asks for implications, ground them in the supplied score reasons and source labels.",
        "Return JSON only."
      ].join(" ");

  const payload = input.items.map((item) => ({
    item_number: item.number,
    profile_key: item.profileKey,
    title: item.title,
    what_changed: item.whatChanged ?? item.summary,
    engineer_relevance: item.engineerRelevance ?? item.whyImportant,
    ai_ecosystem: item.aiEcosystem ?? "",
    market_transmission: item.marketTransmission ?? null,
    affected_assets: item.affectedAssets ?? null,
    why_now: item.whyNow ?? null,
    company_angle: item.companyAngle ?? null,
    ai_capital_angle: item.aiCapitalAngle ?? null,
    openai_angle: item.openAiAngle ?? null,
    repo_use_case: item.repoUseCase ?? null,
    trend_signal: item.trendSignal ?? "",
    cause_effect: item.causeEffect ?? "",
    watchpoints: item.watchpoints ?? [],
    source_label: item.sourceLabel,
    score_reasons: item.scoreReasons,
    keywords: item.keywords,
    source_links: item.sourceLinks,
    evidence_spans: item.evidenceSpans ?? []
  }));

  const userPrompt = financeProfile
    ? [
        `User question: ${input.question}`,
        "Answer using only the provided digest evidence.",
        "Focus on market transmission, affected assets, financing implications, and what changed in today's setup.",
        "Return:",
        "- answer_ko: a concise Korean answer",
        "- bullets_ko: up to 4 short supporting bullets",
        "- used_item_numbers: the item numbers you relied on",
        "- uncertainty_notes: empty array if confidence is high",
        "",
        `Digest themes: ${input.themes.length > 0 ? input.themes.join(" | ") : "none"}`,
        "",
        JSON.stringify(payload, null, 2)
      ].join("\n")
    : [
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
  const financeProfile = hasFinanceItems(input.items);
  const systemPrompt = financeProfile
    ? [
        "You answer a post-digest research question for a single user based on a Korean finance and market brief.",
        "You may use web search, but only to deepen understanding of the digest items supplied in the prompt.",
        "Prefer official and primary sources over commentary when possible.",
        "If the evidence is mixed or incomplete, say so clearly.",
        "Write every sentence in Korean, while preserving English company names, tickers, repo names, product names, and market terms exactly as written.",
        "Do not output whole English sentences or English clause chains.",
        "Only include source URLs you actually used from the search results.",
        "Return JSON only."
      ].join(" ")
    : [
        "You answer a post-digest research question for a single technical user.",
        "You may use web search, but only to deepen understanding of the digest items supplied in the prompt.",
        "Prefer official and primary sources over commentary when possible.",
        "If the evidence is mixed or incomplete, say so clearly.",
        "Write every sentence in Korean, while preserving English product names, company names, repo names, API names, and model names exactly as written.",
        "Do not output whole English sentences or English clause chains.",
        "Only include source URLs you actually used from the search results.",
        "Return JSON only."
      ].join(" ");

  const payload = input.items.map((item) => ({
    item_number: item.number,
    profile_key: item.profileKey,
    title: item.title,
    what_changed: item.whatChanged ?? item.summary,
    engineer_relevance: item.engineerRelevance ?? item.whyImportant,
    ai_ecosystem: item.aiEcosystem ?? "",
    market_transmission: item.marketTransmission ?? null,
    affected_assets: item.affectedAssets ?? null,
    why_now: item.whyNow ?? null,
    company_angle: item.companyAngle ?? null,
    ai_capital_angle: item.aiCapitalAngle ?? null,
    openai_angle: item.openAiAngle ?? null,
    repo_use_case: item.repoUseCase ?? null,
    trend_signal: item.trendSignal ?? "",
    cause_effect: item.causeEffect ?? "",
    watchpoints: item.watchpoints ?? [],
    source_label: item.sourceLabel,
    score_reasons: item.scoreReasons,
    source_links: item.sourceLinks,
    evidence_spans: item.evidenceSpans ?? []
  }));

  const userPrompt = financeProfile
    ? [
        `User question: ${input.question}`,
        "Start from the digest items below, then use live search only to deepen or update the answer.",
        "Focus on rates, liquidity, funding, regulation, earnings, capex, sector impact, and AI capital-chain implications when relevant.",
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
      ].join("\n")
    : [
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

function hasFinanceItems(items: DigestEntry[]): boolean {
  return items.some((item) => item.profileKey === "finance");
}
