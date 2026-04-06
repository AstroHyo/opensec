import { DateTime } from "luxon";
import type { DigestMode, NormalizedItemRecord, ScoreBreakdown } from "./types.js";

interface ScoreContext {
  mode: DigestMode;
  now: DateTime;
  windowStart: DateTime;
  windowEnd: DateTime;
  resendHours: number;
}

const SOURCE_AUTHORITY: Record<NormalizedItemRecord["sourceType"], number> = {
  openai_official: 72,
  geeknews: 44,
  github_trending: 48,
  vendor_official: 38,
  techmeme: 56,
  hacker_news: 52,
  social_signal: 18
};

const OPENAI_CATEGORY_BONUS: Record<string, number> = {
  Product: 22,
  Research: 18,
  Engineering: 20,
  Safety: 21,
  Security: 21,
  Company: 14,
  "External Coverage": 8
};

const GEEKNEWS_KIND_BONUS: Record<string, number> = {
  news: 10,
  ask: -16,
  show: -10
};

const KEYWORD_RULES = [
  { pattern: /\bopenai\b/i, label: "OpenAI", weight: 18 },
  { pattern: /\bgpt\b/i, label: "GPT", weight: 10 },
  { pattern: /\bcodex\b/i, label: "Codex", weight: 12 },
  { pattern: /\bchatgpt\b/i, label: "ChatGPT", weight: 10 },
  { pattern: /\bmodel release\b|\bintroducing\b/i, label: "model release", weight: 8 },
  { pattern: /\bapi\b/i, label: "API", weight: 8 },
  { pattern: /\bsafety\b/i, label: "safety", weight: 10 },
  { pattern: /\bsecurity\b|\bbug bounty\b/i, label: "security", weight: 10 },
  { pattern: /\bresearch\b|\bpaper\b/i, label: "research", weight: 8 },
  { pattern: /\bengineering\b|\bruntime\b/i, label: "engineering", weight: 8 },
  { pattern: /\bagent(s|ic)?\b/i, label: "agents", weight: 11 },
  { pattern: /\bcoding agent\b/i, label: "coding agent", weight: 12 },
  { pattern: /\bclaude code\b/i, label: "Claude Code", weight: 8 },
  { pattern: /\bmcp\b|\bmodel context protocol\b/i, label: "MCP", weight: 12 },
  { pattern: /\btool calling\b/i, label: "tool calling", weight: 8 },
  { pattern: /\bbrowser( |-)?automation\b|\bbrowser-use\b|\bcomputer use\b/i, label: "browser automation", weight: 12 },
  { pattern: /\bevals?\b|\bbenchmark\b/i, label: "evals", weight: 10 },
  { pattern: /\borchestration\b/i, label: "orchestration", weight: 9 },
  { pattern: /\bmemory\b/i, label: "memory", weight: 9 },
  { pattern: /\brag\b/i, label: "RAG", weight: 7 },
  { pattern: /\binference\b/i, label: "inference", weight: 8 },
  { pattern: /\bvector\b/i, label: "vector", weight: 7 },
  { pattern: /\bide\b/i, label: "IDE", weight: 7 },
  { pattern: /\bworkflow\b/i, label: "workflow", weight: 7 },
  { pattern: /\bdeveloper tooling\b|\bdevtool\b|\bsdk\b|\bframework\b|\bcli\b/i, label: "developer tooling", weight: 8 }
];

const METHODOLOGY_RULES = [
  { pattern: /\bworkflow\b|\bpattern\b|\bplaybook\b/i, label: "workflow pattern", weight: 7 },
  { pattern: /\barchitecture\b|\bruntime\b|\borchestration\b/i, label: "architecture", weight: 7 },
  { pattern: /\bevals?\b|\bbenchmark\b|\bmeasurement\b/i, label: "evaluation method", weight: 7 },
  { pattern: /\bbrowser-use\b|\bcomputer use\b|\bshell tool\b/i, label: "tool-use pattern", weight: 7 },
  { pattern: /\bmemory\b|\bstate\b/i, label: "memory", weight: 6 },
  { pattern: /\bprompt injection\b|\bmisalignment\b/i, label: "safety method", weight: 6 }
];

const REPO_POSITIVE_RULES = [
  /\bai\b/i,
  /\bagent(s|ic)?\b/i,
  /\bmcp\b|\bmodel context protocol\b/i,
  /\bbrowser\b/i,
  /\beval(s)?\b/i,
  /\borchestration\b/i,
  /\bmemory\b/i,
  /\binference\b/i,
  /\bvector\b/i,
  /\btool(ing)?\b/i,
  /\bsdk\b/i,
  /\bframework\b/i,
  /\bdeveloper\b/i,
  /\bcoding\b/i,
  /\bautomation\b/i,
  /\bcli\b/i,
  /\bworkflow\b/i
];

const REPO_NEGATIVE_RULES = [
  /\bawesome[- ]list\b/i,
  /\bwallpaper\b/i,
  /\bgame\b/i,
  /\binterview\b/i,
  /\bcheat ?sheet\b/i,
  /\bboilerplate\b/i,
  /\bportfolio\b/i,
  /\bclone\b/i,
  /\bto-do\b/i
];

const REPO_LANGUAGE_BONUS: Record<string, number> = {
  Python: 4,
  TypeScript: 5,
  JavaScript: 3,
  Rust: 4
};

export function scoreItem(item: NormalizedItemRecord, context: ScoreContext): ScoreBreakdown {
  const text = `${item.title} ${item.description ?? ""} ${item.contentText ?? ""} ${item.repoName ?? ""}`;
  const reasons: string[] = [];
  const matchedKeywords = new Set<string>();

  let suppressed = false;
  let authorityScore = SOURCE_AUTHORITY[item.sourceType] ?? 35;
  if (item.sourceType === "openai_official") {
    authorityScore += OPENAI_CATEGORY_BONUS[item.openaiCategory ?? ""] ?? 0;
    reasons.push(`OpenAI 공식 소스 (${item.openaiCategory ?? "General"})`);
  }
  if (item.sourceType === "geeknews" && item.geeknewsKind) {
    authorityScore += GEEKNEWS_KIND_BONUS[item.geeknewsKind] ?? 0;
    reasons.push(`GeekNews ${item.geeknewsKind.toUpperCase()} 신호`);
  }

  const published = DateTime.fromISO(item.publishedAt ?? item.lastSeenAt, { zone: "utc" });
  const hoursOld = Math.max(0, context.now.diff(published, "hours").hours);
  let freshnessScore = 0;
  if (published >= context.windowStart && published <= context.windowEnd) {
    freshnessScore = 35;
    reasons.push("현재 digest 윈도우 내 최신 항목");
  } else if (hoursOld <= 6) {
    freshnessScore = 26;
  } else if (hoursOld <= 24) {
    freshnessScore = 18;
  } else if (hoursOld <= 48) {
    freshnessScore = 10;
  } else if (hoursOld <= 72) {
    freshnessScore = 6;
  } else if (hoursOld <= 120) {
    freshnessScore = 2;
  }

  let keywordScore = 0;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(text)) {
      matchedKeywords.add(rule.label);
      keywordScore += rule.weight;
    }
  }
  keywordScore = Math.min(keywordScore, 42);
  if (matchedKeywords.size > 0) {
    reasons.push(`관심 키워드 일치: ${[...matchedKeywords].join(", ")}`);
  }

  if (
    item.sourceType === "geeknews" &&
    (item.geeknewsKind === "ask" || item.geeknewsKind === "show") &&
    keywordScore < 12
  ) {
    suppressed = true;
    reasons.push("GeekNews Ask/Show지만 AI/tooling relevance가 약함");
  }

  let methodologyScore = 0;
  for (const rule of METHODOLOGY_RULES) {
    if (rule.pattern.test(text)) {
      methodologyScore += rule.weight;
    }
  }
  methodologyScore = Math.min(methodologyScore, 18);
  if (methodologyScore > 0) {
    reasons.push("방법론/운영 패턴 신호");
  }

  let tractionScore = 0;
  if (item.itemKind === "repo") {
    const repoRelevance = computeRepoRelevance(item);
    if (repoRelevance < 12) {
      suppressed = true;
      reasons.push("AI/tooling relevance가 낮아 Repo Radar 제외");
    } else {
      tractionScore += repoRelevance;
      const starsToday = Math.max(0, item.repoStarsToday ?? 0);
      const totalStars = Math.max(0, item.repoStarsTotal ?? 0);
      tractionScore += Math.min(18, Math.sqrt(starsToday) * 0.65 + Math.log10(totalStars + 10) * 4);
      tractionScore += REPO_LANGUAGE_BONUS[item.repoLanguage ?? ""] ?? 0;
      reasons.push(`Repo traction: +${starsToday} today`);
    }
  }

  const precisionSignalScore = computePrecisionSignalScore(item, reasons);
  const earlyWarningScore = computeEarlyWarningScore(item, reasons);
  const crossSignalScore = Math.min(18, Math.max(0, item.crossSignalCount - 1) * 8);
  if (crossSignalScore > 0) {
    reasons.push("복수 소스에서 동시 포착");
  }

  let resendPenalty = 0;
  if (item.lastSentAt) {
    const hoursSinceSent = context.now.diff(DateTime.fromISO(item.lastSentAt, { zone: "utc" }), "hours").hours;
    if (hoursSinceSent < context.resendHours) {
      const meaningfulOpenAiUpdate =
        item.sourceType === "openai_official" &&
        DateTime.fromISO(item.lastUpdatedAt, { zone: "utc" }) >
          DateTime.fromISO(item.lastSentAt, { zone: "utc" });

      if (!meaningfulOpenAiUpdate) {
        resendPenalty = 120;
        suppressed = true;
        reasons.push(`최근 ${context.resendHours}시간 내 이미 전송됨`);
      } else {
        resendPenalty = 12;
        reasons.push("OpenAI 공식 항목 업데이트 감지");
      }
    }
  }

  const total =
    authorityScore +
    freshnessScore +
    keywordScore +
    methodologyScore +
    tractionScore +
    precisionSignalScore +
    earlyWarningScore +
    crossSignalScore -
    resendPenalty;

  return {
    total,
    suppressed,
    authorityScore,
    freshnessScore,
    keywordScore,
    methodologyScore,
    tractionScore,
    crossSignalScore,
    precisionSignalScore,
    earlyWarningScore,
    resendPenalty,
    matchedKeywords: [...matchedKeywords],
    reasons
  };
}

function computePrecisionSignalScore(item: NormalizedItemRecord, reasons: string[]): number {
  const precisionSources = item.sources.filter((source) => source.sourceLayer === "precision");
  if (precisionSources.length === 0) {
    return 0;
  }

  let score = 0;
  for (const source of precisionSources) {
    if (source.sourceType === "techmeme") {
      const isLeadCluster = Boolean((source.payload as Record<string, unknown>)?.isLeadCluster);
      score += isLeadCluster ? 8 : 4;
    } else if (source.sourceType === "hacker_news") {
      const payload = source.payload as Record<string, unknown>;
      const base = 6;
      const scoreSignal = Math.max(0, Number(payload?.score ?? 0));
      const commentSignal = Math.max(0, Number(payload?.descendants ?? payload?.comments ?? 0));
      score += base + Math.min(4, Math.floor(scoreSignal / 200) + Math.floor(commentSignal / 60));
    } else if (source.sourceType === "geeknews") {
      score += 4;
    }
  }

  const capped = Math.min(18, score);
  if (precisionSources.some((source) => source.sourceType === "techmeme")) {
    reasons.push("Techmeme precision 신호");
  }
  if (precisionSources.some((source) => source.sourceType === "hacker_news")) {
    reasons.push("HN precision 신호");
  }
  if (precisionSources.some((source) => source.sourceType === "geeknews")) {
    reasons.push("GeekNews precision 신호");
  }

  return capped;
}

function computeEarlyWarningScore(item: NormalizedItemRecord, reasons: string[]): number {
  const distinctActors = [...new Set(item.matchedSignals.map((match) => match.signal.actorLabel.trim().toLowerCase()))].filter(Boolean);
  if (distinctActors.length === 0) {
    return 0;
  }

  const score = Math.min(6, distinctActors.length * 2 + (distinctActors.length >= 2 ? 1 : 0));
  reasons.push("Bluesky signal");
  return score;
}

export function isRelevantRepo(item: NormalizedItemRecord): boolean {
  if (item.itemKind !== "repo") {
    return false;
  }

  return computeRepoRelevance(item) >= 12;
}

function computeRepoRelevance(item: NormalizedItemRecord): number {
  const text = `${item.title} ${item.description ?? ""} ${item.repoName ?? ""} ${item.repoLanguage ?? ""}`;
  let score = 0;

  for (const rule of REPO_POSITIVE_RULES) {
    if (rule.test(text)) {
      score += 4;
    }
  }

  for (const rule of REPO_NEGATIVE_RULES) {
    if (rule.test(text)) {
      score -= 8;
    }
  }

  return score;
}
