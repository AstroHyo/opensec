import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import type { NewsDatabase } from "../db.js";
import { getProfileConfig, matchesProfile } from "../profiles.js";
import { isRelevantRepo, scoreItem } from "../scoring.js";
import type {
  DigestBuildResult,
  DigestEntry,
  DigestMode,
  DigestSection,
  NormalizedItemRecord,
  ProfileKey,
  ScoreBreakdown
} from "../types.js";
import { resolveDigestWindow } from "../util/timeWindow.js";
import {
  buildSuppressionFingerprint,
  findRecentSuppressionMatch,
  type RecentSentIdentity
} from "../util/suppression.js";
import { collapseWhitespace, truncate } from "../util/text.js";
import { renderTelegramDigest } from "./renderTelegram.js";

interface BuildDigestParams {
  db: NewsDatabase;
  config: AppConfig;
  profileKey: ProfileKey;
  mode: DigestMode;
  now: DateTime;
}

interface ScoredItem {
  item: NormalizedItemRecord;
  score: ScoreBreakdown;
  suppressionReason?: string;
  suppressionOverrideReason?: string;
}

export function buildDigest({ db, config, profileKey, mode, now }: BuildDigestParams): DigestBuildResult {
  const profile = getProfileConfig(profileKey);
  const lastAmDigest = db.getLatestDigest(profileKey, "am");
  const lastPmDigest = db.getLatestDigest(profileKey, "pm");
  const window = resolveDigestWindow({
    mode,
    timezone: config.timezone,
    now,
    lastAmDigest,
    lastPmDigest
  });

  const windowStart = DateTime.fromISO(window.startUtc, { zone: "utc" });
  const windowEnd = DateTime.fromISO(window.endUtc, { zone: "utc" });
  const lookbackStart = windowStart.minus({ hours: 72 }).toISO() ?? window.startUtc;
  const candidates = db.listCandidateItems(profileKey, lookbackStart).filter((item) => matchesProfile(item, profileKey));

  const scored = candidates
    .map((item) => ({
      item,
      score: scoreItem(item, {
        profileKey,
        mode,
        now: now.toUTC(),
        windowStart,
        windowEnd,
        resendHours: 72
      })
    }))
    .filter((entry) => isNotFuture(entry, windowEnd))
    .filter((entry) => includeItem(entry, mode, profileKey))
    .sort(sortScoredItems);
  const dedupedScored = applyStrongRecentSuppression({
    db,
    profileKey,
    mode,
    now: now.toUTC(),
    scored
  });

  const emptyHeader = profile.briefTitles[mode];

  if (dedupedScored.length === 0) {
    const header = `[${emptyHeader} | ${window.dateLabel} ET]`;
    return {
      profileKey,
      mode,
      header,
      window,
      sections: [
        {
          key: "quiet",
          title: "오늘은 억지로 채우지 않음",
          items: [],
          bullets: ["고신호로 볼 만한 새 항목이 부족해 low-quality filler 없이 건너뜁니다."]
        }
      ],
      themes: [],
      items: [],
      bodyText: `${header}\n\n1) 오늘은 억지로 채우지 않음\n- 고신호로 볼 만한 새 항목이 부족해 low-quality filler 없이 건너뜁니다.`,
      stats: {
        candidateCount: candidates.length,
        includedCount: 0,
        recentSuppressionWindowHours: 72,
        suppressedRecentDuplicates: scored.length
      }
    };
  }

  const candidateEntries =
    profileKey === "tech" ? buildCandidateEntries(dedupedScored, mode, profileKey, config) : undefined;

  const sections =
    profileKey === "finance"
      ? mode === "am"
        ? buildFinanceAmSections(dedupedScored)
        : mode === "pm"
          ? buildFinancePmSections(dedupedScored)
          : buildManualSections(dedupedScored, profileKey)
      : buildTechSectionsFromEntries(candidateEntries ?? [], mode);
  assignNumbers(sections);
  const items = sections.flatMap((section) => section.items);
  const themes = buildThemes(items, mode, profileKey);
  applyThemeSections(sections, themes, mode, profileKey);

  const header = `[${emptyHeader} | ${window.dateLabel} ET]`;
  const result: DigestBuildResult = {
    profileKey,
    mode,
    header,
    window,
      sections,
      themes,
      items,
      candidateEntries,
      bodyText: "",
      stats: {
        candidateCount: candidates.length,
        includedCount: items.length,
        recentSuppressionWindowHours: 72,
        suppressedRecentDuplicates: scored.length - dedupedScored.length
    }
  };

  result.bodyText = renderTelegramDigest(result);
  return result;
}

function buildCandidateEntries(
  scored: ScoredItem[],
  mode: DigestMode,
  profileKey: ProfileKey,
  config: AppConfig
): DigestEntry[] {
  const targetCount =
    mode === "am" ? Math.max(8, config.llm.maxItemsAm) : mode === "pm" ? Math.max(12, config.llm.maxItemsPm) : 12;

  return scored.slice(0, targetCount).map((entry) => toDigestEntry(entry, "candidate_pool", profileKey));
}

function includeItem(entry: ScoredItem, mode: DigestMode, profileKey: ProfileKey): boolean {
  if (profileKey === "finance") {
    return includeFinanceItem(entry, mode);
  }

  return includeTechItem(entry, mode);
}

function includeTechItem(entry: ScoredItem, mode: DigestMode): boolean {
  const total = entry.score.total;
  const isOfficialOpenAi = entry.item.sourceType === "openai_official";
  const isRepo = entry.item.itemKind === "repo";

  if (entry.score.suppressed) {
    return false;
  }

  if (isOfficialOpenAi) {
    return total >= (mode === "am" ? 62 : 58);
  }

  if (isRepo) {
    return total >= (mode === "am" ? 76 : 68) && isRelevantRepo(entry.item);
  }

  return total >= (mode === "am" ? 70 : 62);
}

function includeFinanceItem(entry: ScoredItem, mode: DigestMode): boolean {
  if (entry.score.suppressed) {
    return false;
  }

  if (entry.item.primarySourceId === "major_company_filings") {
    return entry.score.total >= (mode === "am" ? 74 : 68);
  }

  return entry.score.total >= (mode === "am" ? 64 : 58);
}

function sortScoredItems(left: ScoredItem, right: ScoredItem): number {
  if (right.score.total !== left.score.total) {
    return right.score.total - left.score.total;
  }

  const rightTime = DateTime.fromISO(right.item.publishedAt ?? right.item.lastSeenAt, { zone: "utc" }).toMillis();
  const leftTime = DateTime.fromISO(left.item.publishedAt ?? left.item.lastSeenAt, { zone: "utc" }).toMillis();
  return rightTime - leftTime;
}

function applyStrongRecentSuppression(input: {
  db: NewsDatabase;
  profileKey: ProfileKey;
  mode: DigestMode;
  now: DateTime;
  scored: ScoredItem[];
}): ScoredItem[] {
  const selected: ScoredItem[] = [];
  const currentDigestFingerprints: RecentSentIdentity[] = [];
  const recentSent =
    input.mode === "manual"
      ? []
      : input.db.listRecentSentItems(input.profileKey, input.now.minus({ hours: 72 }).toISO() ?? input.now.toISO() ?? "");

  for (const entry of input.scored) {
    const fingerprint = buildSuppressionFingerprint(entry.item);
    if (findRecentSuppressionMatch(fingerprint, currentDigestFingerprints)) {
      continue;
    }

    const recentMatch = findRecentSuppressionMatch(fingerprint, recentSent);
    if (recentMatch) {
      const overrideReason = maybeAllowRecentResend(entry.item, recentMatch.match);
      if (!overrideReason) {
        continue;
      }
      entry.suppressionReason = recentMatch.reason;
      entry.suppressionOverrideReason = overrideReason;
    }

    selected.push(entry);
    currentDigestFingerprints.push({
      itemId: entry.item.id,
      sentAt: input.now.toISO() ?? new Date().toISOString(),
      sectionKey: null,
      canonicalIdentityHash: fingerprint.canonicalIdentityHash,
      storyClusterHash: fingerprint.storyClusterHash,
      titleSnapshot: fingerprint.titleSnapshot,
      urlSnapshot: fingerprint.urlSnapshot,
      repoKey: fingerprint.repoKey,
      normalizedTitle: fingerprint.normalizedTitle,
      titleHash: fingerprint.titleHash ?? null,
      sourceType: fingerprint.sourceType,
      contentSourceHash: null,
      lastUpdatedSnapshot: entry.item.lastUpdatedAt
    });
  }

  return selected;
}

function maybeAllowRecentResend(item: NormalizedItemRecord, recent: RecentSentIdentity): string | null {
  if (item.sourceType !== "openai_official") {
    return null;
  }

  const itemUpdated = DateTime.fromISO(item.lastUpdatedAt, { zone: "utc" });
  const previousUpdated = recent.lastUpdatedSnapshot
    ? DateTime.fromISO(recent.lastUpdatedSnapshot, { zone: "utc" })
    : DateTime.fromISO(recent.sentAt, { zone: "utc" });

  if (itemUpdated.isValid && previousUpdated.isValid && itemUpdated.toMillis() > previousUpdated.toMillis()) {
    return "official_openai_material_update";
  }

  return null;
}

export function buildTechSectionsFromEntries(entries: DigestEntry[], mode: DigestMode): DigestSection[] {
  if (mode === "am") {
    return buildTechAmSections(entries);
  }

  if (mode === "pm") {
    return buildTechPmSections(entries);
  }

  return [
    {
      key: "highlights",
      title: "Highlights",
      items: entries.slice(0, 6).map((entry) => ({ ...entry, sectionKey: "highlights" }))
    }
  ];
}

function buildTechAmSections(entries: DigestEntry[]): DigestSection[] {
  const topSignals = entries.filter((entry) => entry.itemKind !== "repo").slice(0, 3);
  const used = new Set(topSignals.map((entry) => entry.itemId));
  const openAiWatch = entries
    .filter((entry) => entry.sourceType === "openai_official" && !used.has(entry.itemId))
    .slice(0, 1);
  const usedWithOpenAi = new Set([...used, ...openAiWatch.map((entry) => entry.itemId)]);
  const repoRadar = entries.filter((entry) => entry.itemKind === "repo" && !usedWithOpenAi.has(entry.itemId)).slice(0, 1);

  return [
    {
      key: "top_signals",
      title: "Top Signals",
      items: topSignals.map((entry) => ({ ...entry, sectionKey: "top_signals" }))
    },
    {
      key: "openai_watch",
      title: "OpenAI Watch",
      items: openAiWatch.map((entry) => ({ ...entry, sectionKey: "openai_watch" }))
    },
    {
      key: "repo_radar",
      title: "Repo Radar",
      items: repoRadar.map((entry) => ({ ...entry, sectionKey: "repo_radar" }))
    },
    {
      key: "themes",
      title: "오늘의 시그널",
      items: [],
      bullets: []
    }
  ];
}

function buildTechPmSections(entries: DigestEntry[]): DigestSection[] {
  const topDevelopments = entries.filter((entry) => entry.itemKind !== "repo").slice(0, 5);
  const used = new Set(topDevelopments.map((entry) => entry.itemId));
  const openAiWatch = entries
    .filter((entry) => entry.sourceType === "openai_official" && !used.has(entry.itemId))
    .slice(0, 1);
  const usedWithOpenAi = new Set([...used, ...openAiWatch.map((entry) => entry.itemId)]);
  const toolingMethods = entries.filter((entry) => !usedWithOpenAi.has(entry.itemId) && isToolingMethodsEntry(entry)).slice(0, 1);
  const usedWithTooling = new Set([...usedWithOpenAi, ...toolingMethods.map((entry) => entry.itemId)]);
  const repoRadar = entries.filter((entry) => entry.itemKind === "repo" && !usedWithTooling.has(entry.itemId)).slice(0, 1);

  return [
    {
      key: "top_developments",
      title: "Top Developments",
      items: topDevelopments.map((entry) => ({ ...entry, sectionKey: "top_developments" }))
    },
    {
      key: "openai_watch",
      title: "OpenAI Watch",
      items: openAiWatch.map((entry) => ({ ...entry, sectionKey: "openai_watch" }))
    },
    {
      key: "tooling_methods",
      title: "Methods / Tooling",
      items: toolingMethods.map((entry) => ({ ...entry, sectionKey: "tooling_methods" }))
    },
    {
      key: "repo_radar",
      title: "Repo Radar",
      items: repoRadar.map((entry) => ({ ...entry, sectionKey: "repo_radar" }))
    },
    {
      key: "what_this_means",
      title: "오늘의 변화 방향",
      items: [],
      bullets: []
    }
  ];
}

function buildFinanceAmSections(scored: ScoredItem[]): DigestSection[] {
  const macro = scored.filter((entry) => financeBucket(entry.item) !== "company" && financeBucket(entry.item) !== "regulation").slice(0, 4);
  const macroIds = new Set(macro.map((entry) => entry.item.id));
  const policy = scored
    .filter((entry) => financeBucket(entry.item) === "regulation" && !macroIds.has(entry.item.id))
    .slice(0, 3);
  const used = new Set([...macroIds, ...policy.map((entry) => entry.item.id)]);
  const companies = scored.filter((entry) => financeBucket(entry.item) === "company" && !used.has(entry.item.id)).slice(0, 3);

  return [
    {
      key: "macro_check",
      title: "매크로 체크",
      items: macro.map((entry) => toDigestEntry(entry, "macro_check", "finance"))
    },
    {
      key: "policy_watch",
      title: "정책 / 규제",
      items: policy.map((entry) => toDigestEntry(entry, "policy_watch", "finance"))
    },
    {
      key: "major_companies",
      title: "대형주 / 기업",
      items: companies.map((entry) => toDigestEntry(entry, "major_companies", "finance"))
    },
    {
      key: "themes",
      title: "오늘 보이는 흐름",
      items: [],
      bullets: []
    }
  ];
}

function buildFinancePmSections(scored: ScoredItem[]): DigestSection[] {
  const topDevelopments = scored.slice(0, 6);
  const topIds = new Set(topDevelopments.map((entry) => entry.item.id));
  const macro = scored
    .filter((entry) => !topIds.has(entry.item.id) && financeBucket(entry.item) !== "company" && financeBucket(entry.item) !== "regulation")
    .slice(0, 4);
  const used = new Set([...topIds, ...macro.map((entry) => entry.item.id)]);
  const policy = scored.filter((entry) => !used.has(entry.item.id) && financeBucket(entry.item) === "regulation").slice(0, 3);
  const usedNext = new Set([...used, ...policy.map((entry) => entry.item.id)]);
  const companies = scored.filter((entry) => !usedNext.has(entry.item.id) && financeBucket(entry.item) === "company").slice(0, 4);

  return [
    {
      key: "top_developments",
      title: "Top developments",
      items: topDevelopments.map((entry) => toDigestEntry(entry, "top_developments", "finance"))
    },
    {
      key: "macro_rates",
      title: "Macro / Rates",
      items: macro.map((entry) => toDigestEntry(entry, "macro_rates", "finance"))
    },
    {
      key: "policy_regulation",
      title: "Policy / Regulation",
      items: policy.map((entry) => toDigestEntry(entry, "policy_regulation", "finance"))
    },
    {
      key: "major_companies",
      title: "Major Companies",
      items: companies.map((entry) => toDigestEntry(entry, "major_companies", "finance"))
    },
    {
      key: "what_this_means",
      title: "What this means",
      items: [],
      bullets: []
    }
  ];
}

function buildManualSections(scored: ScoredItem[], profileKey: ProfileKey): DigestSection[] {
  const highlights = scored.slice(0, 8);
  return [
    {
      key: "highlights",
      title: "Highlights",
      items: highlights.map((entry) => toDigestEntry(entry, "highlights", profileKey))
    }
  ];
}

function toDigestEntry(entry: ScoredItem, sectionKey: string, profileKey: ProfileKey): DigestEntry {
  const sourceLinks = dedupeSourceLinks(entry.item);
  const title = entry.item.repoName && entry.item.repoOwner ? `${entry.item.repoOwner}/${entry.item.repoName}` : entry.item.title;
  const techInsight = profileKey === "tech" ? buildTechInsight(entry.item, entry.score) : null;
  const deterministicScore = Math.round(entry.score.total);
  const derivedWhyImportant =
    techInsight == null
      ? buildWhyImportant(entry.item, entry.score, profileKey)
      : truncate([techInsight.engineerRelevance, techInsight.aiEcosystem].filter(Boolean).join(" "), 220);
  return {
    profileKey,
    number: 0,
    itemId: entry.item.id,
    sectionKey,
    sourceType: entry.item.sourceType,
    itemKind: entry.item.itemKind,
    title,
    summary: techInsight?.whatChanged ?? buildSummary(entry.item, entry.score, profileKey),
    whyImportant: derivedWhyImportant,
    whatChanged: techInsight?.whatChanged,
    engineerRelevance: techInsight?.engineerRelevance,
    aiEcosystem: techInsight?.aiEcosystem,
    openAiAngle: techInsight?.openAiAngle ?? null,
    repoUseCase: techInsight?.repoUseCase ?? null,
    trendSignal: techInsight?.trendSignal,
    causeEffect: techInsight?.causeEffect,
    watchpoints: techInsight?.watchpoints ?? [],
    evidenceSpans: techInsight?.evidenceSpans ?? [],
    contentSnippet: truncate(entry.item.contentText ?? entry.item.description ?? entry.item.title, 220),
    primaryUrl: sourceLinks[0]?.url ?? entry.item.originalUrl ?? entry.item.sourceUrl,
    sourceLabel: entry.item.primarySourceLabel,
    score: deterministicScore,
    deterministicScore,
    rerankDelta: 0,
    finalScore: deterministicScore,
    scoreReasons: entry.score.reasons,
    sourceLinks,
    signalLinks: dedupeSignalLinks(entry.item),
    openaiCategory: entry.item.openaiCategory,
    repoLanguage: entry.item.repoLanguage,
    repoStarsToday: entry.item.repoStarsToday,
    repoStarsTotal: entry.item.repoStarsTotal,
    keywords: entry.score.matchedKeywords,
    description: entry.item.description,
    metadata: {
      ...entry.item.metadata,
      lastUpdatedAt: entry.item.lastUpdatedAt,
      suppression:
        entry.suppressionReason || entry.suppressionOverrideReason
          ? {
              reason: entry.suppressionReason ?? null,
              overrideReason: entry.suppressionOverrideReason ?? null
            }
          : undefined
    }
  };
}

function dedupeSourceLinks(item: NormalizedItemRecord): Array<{ label: string; url: string }> {
  const grouped = new Map<string, { url: string; labels: string[]; priority: number }>();

  const orderedSources = [...item.sources].sort((left, right) => {
    const leftPriority = left.sourceLayer === "primary" ? 0 : 1;
    const rightPriority = right.sourceLayer === "primary" ? 0 : 1;
    return leftPriority - rightPriority || left.sourceLabel.localeCompare(right.sourceLabel);
  });

  for (const source of orderedSources) {
    const url = source.originalUrl ?? source.sourceUrl;
    const priority = source.sourceLayer === "primary" ? 0 : 1;
    const existing = grouped.get(url);
    if (!existing) {
      grouped.set(url, { url, labels: [source.sourceLabel], priority });
      continue;
    }
    if (!existing.labels.includes(source.sourceLabel)) {
      existing.labels.push(source.sourceLabel);
    }
    existing.priority = Math.min(existing.priority, priority);
  }

  if (grouped.size === 0) {
    grouped.set(item.originalUrl ?? item.sourceUrl, {
      url: item.originalUrl ?? item.sourceUrl,
      labels: [item.primarySourceLabel],
      priority: item.primarySourceLayer === "primary" ? 0 : 1
    });
  }

  return [...grouped.values()]
    .sort((left, right) => left.priority - right.priority || left.url.localeCompare(right.url))
    .map((entry) => ({ label: entry.labels.join(", "), url: entry.url }));
}

function dedupeSignalLinks(item: NormalizedItemRecord): Array<{ label: string; url: string }> {
  const seen = new Set<string>();
  const links: Array<{ label: string; url: string }> = [];

  for (const match of item.matchedSignals) {
    const url = match.signal.postUrl;
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    links.push({
      label: `${match.signal.actorLabel} / Bluesky`,
      url
    });
  }

  return links;
}

function buildSummary(item: NormalizedItemRecord, score: ScoreBreakdown, profileKey: ProfileKey): string {
  if (profileKey === "finance") {
    return buildFinanceSummary(item);
  }

  const topicPhrase = buildTopicPhrase(score.matchedKeywords);

  if (item.sourceType === "openai_official") {
    const categoryPhrase =
      {
        Product: "Product 업데이트",
        Research: "연구/방법론 업데이트",
        Engineering: "Engineering 업데이트",
        Safety: "Safety 업데이트",
        Security: "Security 업데이트",
        Company: "Company 업데이트",
        "External Coverage": "외부 보도/coverage"
      }[item.openaiCategory ?? "Company"] ?? "공식 업데이트";

    return truncate(
      `${categoryPhrase}를 다룬 OpenAI 공식 항목입니다. 핵심 초점은 ${topicPhrase ?? "제품 방향과 개발자 영향"} 입니다.`,
      120
    );
  }

  if (item.itemKind === "repo") {
    const repoTopic = topicPhrase ?? "AI tooling / developer workflow";
    return truncate(
      `${repoTopic} 쪽에서 실험 가치가 큰 ${item.repoLanguage ?? "주요"} repo입니다. GitHub Trending 신호가 강합니다.`,
      120
    );
  }

  if (item.sourceType === "geeknews") {
    const snippet = truncate(item.contentText ?? item.description ?? item.title, 100);
    return truncate(`GeekNews에서 화제가 된 주제입니다. ${snippet}`, 120);
  }

  if (item.sourceType === "techmeme") {
    return truncate("Techmeme가 메인 cluster로 집계한 항목입니다. 시장 전체에서 확산 중인 주제인지 보기 좋습니다.", 120);
  }

  if (item.sourceType === "hacker_news") {
    return truncate("Hacker News에서 빠르게 주목받는 항목입니다. 개발자 반응과 실전 relevance를 같이 볼 수 있습니다.", 120);
  }

  return truncate(`${topicPhrase ?? "실무 영향이 있는 신호"}를 중심으로 본 항목입니다.`, 120);
}

function buildTechInsight(
  item: NormalizedItemRecord,
  score: ScoreBreakdown
): {
  whatChanged: string;
  engineerRelevance: string;
  aiEcosystem: string;
  openAiAngle?: string | null;
  repoUseCase?: string | null;
  trendSignal: string;
  causeEffect: string;
  watchpoints: string[];
  evidenceSpans: string[];
} {
  const snippet = truncate(selectEvidenceSentence(item), 280);
  const topicPhrase = buildTopicPhrase(score.matchedKeywords);
  const evidenceSpans = buildDeterministicEvidenceSpans(item, snippet);

  if (item.sourceType === "openai_official") {
    const categoryLabel = item.openaiCategory ?? "Company";
    return {
      whatChanged: truncate(
        `OpenAI 공식 ${categoryLabel} 업데이트입니다. ${snippet || "이번 항목은 제품/API/연구 방향에 대한 직접 신호를 제공합니다."}`,
        320
      ),
      engineerRelevance: truncate(
        buildOpenAiEngineerRelevance(item, score, topicPhrase),
        260
      ),
      aiEcosystem: truncate(
        `공식 발표가 먼저 나오면 이후 agent tooling, SDK, eval, orchestration 계층이 그 방향에 맞춰 빠르게 재정렬됩니다. ${item.crossSignalCount > 1 ? "이미 다른 소스에서도 반응이 붙기 시작했습니다." : ""}`,
        260
      ),
      openAiAngle: truncate(
        `이번 항목은 OpenAI가 어디에 자원을 쓰고 무엇을 제품화하려는지 직접 보여주는 신호입니다.`,
        220
      ),
      repoUseCase: null,
      trendSignal: truncate(
        `${topicPhrase ?? "OpenAI product/engineering"}이 단발 뉴스가 아니라 운영 가능한 스택으로 굳어지는 흐름입니다.`,
        220
      ),
      causeEffect: truncate(
        `공식 방향이 나온 직후에는 문서, SDK, 서드파티 tooling, 팀 내부 실험 우선순위가 뒤따라 바뀌는 경우가 많습니다.`,
        220
      ),
      watchpoints: buildWatchpoints(item, score),
      evidenceSpans
    };
  }

  if (item.itemKind === "repo") {
    return {
      whatChanged: truncate(
        `${item.repoOwner && item.repoName ? `${item.repoOwner}/${item.repoName}` : item.title}가 GitHub Trending에서 강하게 올라왔습니다. ${snippet}`,
        320
      ),
      engineerRelevance: truncate(
        `${item.repoLanguage ?? "주요"} stack에서 바로 실험 가능한 repo이고, ${item.repoStarsToday ? `하루 stars +${item.repoStarsToday}` : "최근 traction"}가 붙었다는 건 README 수준 아이디어보다 실제 재현과 도입 시도가 늘고 있다는 뜻에 가깝습니다. 설치 경로, 권한 경계, 기존 workflow와의 접점을 빠르게 검증해볼 가치가 있습니다.`,
        260
      ),
      aiEcosystem: truncate(
        `${topicPhrase ?? "agent/devtool"} 쪽 차별점이 모델 자체보다 runtime, memory, orchestration, developer ergonomics 같은 실행 계층으로 이동하고 있다는 신호입니다.`,
        220
      ),
      openAiAngle: score.matchedKeywords.includes("OpenAI")
        ? truncate("OpenAI API 또는 OpenAI 중심 워크플로우와 결합될 가능성이 높아 실제 엔지니어링 실험 경로가 짧습니다.", 220)
        : null,
      repoUseCase: truncate(
        buildRepoUseCase(item, score),
        240
      ),
      trendSignal: truncate(
        `상위 repo들이 공통으로 가리키는 변화는 모델 호출 자체보다 agent runtime, MCP, browser automation, eval tooling 같은 실행 계층이 두꺼워지고 있다는 점입니다.`,
        220
      ),
      causeEffect: truncate(
        `모델 기능이 표준화될수록 차별점은 orchestration과 developer ergonomics로 이동하고, 그래서 이런 repo들이 더 빨리 주목받습니다.`,
        220
      ),
      watchpoints: buildWatchpoints(item, score),
      evidenceSpans
    };
  }

  return {
    whatChanged: truncate(
      `${snippet || item.title} ${item.sourceType === "geeknews" ? "GeekNews에서 강한 토론 신호가 붙었습니다." : ""}`,
      320
    ),
    engineerRelevance: truncate(
      buildGeneralEngineerRelevance(item, score, topicPhrase),
      260
    ),
    aiEcosystem: truncate(
      buildAiEcosystemView(item, score, topicPhrase),
      240
    ),
    openAiAngle: score.matchedKeywords.includes("OpenAI")
      ? truncate("이 흐름은 OpenAI 생태계와의 접점에서 API 설계, 개발자 workflow, 경쟁사 대응 방식을 같이 바꿀 가능성이 큽니다.", 220)
      : null,
    repoUseCase: null,
    trendSignal: truncate(
      `${topicPhrase ?? "실무형 AI tooling"}이 발표/데모 단계에서 운영 패턴 단계로 이동하고 있다는 신호입니다.`,
      220
    ),
    causeEffect: truncate(
      buildCauseEffect(item, score),
      220
    ),
    watchpoints: buildWatchpoints(item, score),
    evidenceSpans
  };
}

function buildWhyImportant(item: NormalizedItemRecord, score: ScoreBreakdown, profileKey: ProfileKey): string {
  if (profileKey === "finance") {
    return buildFinanceWhyImportant(item);
  }

  if (item.sourceType === "openai_official") {
    return truncate("공식 소스라 노이즈가 적고, OpenAI 제품/API/안전성 방향을 직접 보여주는 신호입니다.", 110);
  }

  if (item.itemKind === "repo") {
    const repoReason = item.repoStarsToday ? `오늘 별 증가가 +${item.repoStarsToday}로 빠르고` : "오늘 traction이 높고";
    return truncate(`${repoReason} agent/devtool ecosystem과 맞닿아 있어 바로 실험해볼 가치가 큽니다.`, 110);
  }

  if (score.methodologyScore >= 10) {
    return truncate("단순 소식보다 workflow, eval, memory 같은 운영 방법론에 연결되는 항목입니다.", 110);
  }

  if (item.crossSignalCount > 1) {
    return truncate("여러 소스에서 동시에 잡혀 실제 파급 가능성이 더 큰 항목입니다.", 110);
  }

  if (item.matchedSignals.length > 0) {
    return truncate("저장된 기사 근거에 더해 Bluesky watch 신호까지 붙어 있어 추가 확산 가능성을 같이 봐야 합니다.", 110);
  }

  return truncate("실무자 관점에서 신호 밀도가 높아 짧게라도 확인할 만한 항목입니다.", 110);
}

function buildOpenAiEngineerRelevance(
  item: NormalizedItemRecord,
  score: ScoreBreakdown,
  topicPhrase: string | null
): string {
  if (item.openaiCategory === "Product") {
    return `API surface, SDK integration, rollout scope, pricing/limits 같은 실제 구현 포인트가 바뀔 수 있어 바로 문서와 샘플 코드를 확인해야 합니다. ${topicPhrase ? `${topicPhrase}과 연결되는 내부 tooling 실험도 다시 잡아야 합니다.` : ""}`;
  }

  if (item.openaiCategory === "Research" || item.openaiCategory === "Engineering") {
    return `단순 PR이 아니라 model/runtime/tooling 설계 방향을 보여주는 경우가 많아서 eval, agent architecture, orchestration 계층에 영향을 줍니다.`;
  }

  if (item.openaiCategory === "Safety" || item.openaiCategory === "Security") {
    return `안전/보안 항목은 나중 문구가 아니라 deployment gate, policy enforcement, logging, eval 기준으로 이어질 수 있어서 구현팀에도 직접 영향이 있습니다.`;
  }

  return `OpenAI가 지금 무엇을 밀고 무엇을 조심하는지 직접 보여줘서, 외부 생태계보다 먼저 제품/엔지니어링 방향을 읽을 수 있습니다.`;
}

function buildGeneralEngineerRelevance(
  item: NormalizedItemRecord,
  score: ScoreBreakdown,
  topicPhrase: string | null
): string {
  if (score.methodologyScore >= 10) {
    return `이 항목은 단순 뉴스보다 workflow 설계와 평가 방식에 더 가깝습니다. ${topicPhrase ? `${topicPhrase}을 실제 파이프라인에 넣을 때 어떤 제어점이 필요한지 보게 만듭니다.` : "실전 운영 관점에서 바뀌는 제어점을 확인할 가치가 큽니다."}`;
  }

  if (item.sourceType === "geeknews") {
    return `GeekNews에서 토론이 붙었다는 건 한국 개발자들이 실전 도입 관점에서 이 주제를 보고 있다는 뜻입니다. 구현 난이도와 체감 가치가 함께 검증될 가능성이 큽니다.`;
  }

  return `구현팀 입장에서는 새 기능보다 기존 pipeline 어디를 고쳐야 하는지가 중요합니다. 이 항목은 integration 경계, 운영 절차, 검증 비용 중 어떤 부분이 바뀌는지 확인할 가치가 있습니다.`;
}

function buildAiEcosystemView(item: NormalizedItemRecord, score: ScoreBreakdown, topicPhrase: string | null): string {
  if (item.crossSignalCount > 1) {
    return `하나의 소스만이 아니라 여러 경로에서 동시에 잡히고 있어, 단발 화제가 아니라 ecosystem-wide signal일 가능성이 큽니다. ${topicPhrase ? `${topicPhrase}의 공통 관심사가 모이고 있습니다.` : ""}`;
  }

  if (item.matchedSignals.length > 0) {
    return `저장된 원문 외에 빠른 social signal까지 붙어 있어 확산 속도가 빠를 수 있습니다. 이런 항목은 며칠 내에 유사 툴과 대응 글이 따라붙는 경우가 많습니다.`;
  }

  return `${topicPhrase ?? "AI tooling"}에서 경쟁축이 데모 기능보다 배포 가능한 runtime, 운영 제어점, 개발자 경험 쪽으로 옮겨가고 있습니다. 그래서 도입팀은 모델 성능만이 아니라 실행 구조까지 같이 비교해야 합니다.`;
}

function buildCauseEffect(item: NormalizedItemRecord, score: ScoreBreakdown): string {
  if (item.sourceType === "geeknews") {
    return "커뮤니티 토론이 먼저 붙는 항목은 대개 곧 벤더 블로그, OSS release, 팀 내부 실험 메모로 확장됩니다.";
  }

  if (score.methodologyScore >= 10) {
    return "이런 방법론형 항목은 발표 직후보다 1~2주 안에 템플릿, 프레임워크, 예제 repo 형태로 파생물이 늘어나는 경우가 많습니다.";
  }

  if (item.itemKind === "repo") {
    return "의미 있는 repo는 곧 wrapper SDK, blog post, integration adapter를 낳기 때문에 지금 traction이 이후 표준 workflow의 선행지표가 되곤 합니다.";
  }

  return "지금은 발표 자체보다 후속 구현물과 생태계 반응이 무엇으로 이어지는지를 보는 게 더 중요합니다.";
}

function buildWatchpoints(item: NormalizedItemRecord, score: ScoreBreakdown): string[] {
  const points: string[] = [];

  if (item.sourceType === "openai_official") {
    points.push("API docs, SDK changelog, rollout scope가 실제로 어떻게 바뀌는지 확인");
  }

  if (item.itemKind === "repo") {
    points.push("README promise와 실제 issue/release cadence가 맞는지 확인");
  }

  if (score.methodologyScore >= 10) {
    points.push("데모가 아니라 eval 기준과 운영 제어점까지 제시하는지 확인");
  }

  if (item.matchedSignals.length > 0) {
    points.push("초기 social signal이 실제 adoption으로 이어지는지 며칠 더 관찰");
  }

  points.push("이 흐름이 우리 workflow나 실험 우선순위를 바꿀 수준인지 판단");
  return uniqueNonEmpty(points).slice(0, 3);
}

function buildRepoUseCase(item: NormalizedItemRecord, score: ScoreBreakdown): string {
  const repoLabel = item.repoOwner && item.repoName ? `${item.repoOwner}/${item.repoName}` : item.title;
  const text = `${item.title} ${item.description ?? ""} ${item.contentText ?? ""} ${score.matchedKeywords.join(" ")}`.toLowerCase();

  if (/(mcp|tool calling|tool-use|tools)/i.test(text)) {
    return `OpenSec 같은 개인 운영 스택에서는 ${repoLabel}를 skill/exec 경계에 붙여 agent 도구 연결과 권한 제어를 더 일관되게 만들 수 있습니다.`;
  }

  if (/(browser|playwright|computer use|automation)/i.test(text)) {
    return `OpenSec에서는 ${repoLabel}를 follow-up 조사나 반복 운영 작업에 붙여 브라우저 기반 수작업을 줄이는 실험을 해볼 만합니다.`;
  }

  if (/(memory|context|session|mem)/i.test(text)) {
    return `OpenSec에서는 ${repoLabel}를 장기 작업 문맥 저장 계층에 붙여 follow-up 답변과 에이전트 연속성을 높이는 식으로 활용할 수 있습니다.`;
  }

  if (/(eval|benchmark|judge|grading)/i.test(text)) {
    return `OpenSec에서는 ${repoLabel}를 digest 품질 점검이나 follow-up 회귀 테스트에 연결해 출력 품질 변동을 더 빨리 잡을 수 있습니다.`;
  }

  return `OpenSec 같은 개인 운영 스택에서는 ${repoLabel}를 별도 실험 흐름에 붙여 반복 작업을 작은 agent 단계로 분리하고 운영 자동화를 더 촘촘하게 만들 수 있습니다.`;
}

function buildDeterministicEvidenceSpans(item: NormalizedItemRecord, snippet: string): string[] {
  return uniqueNonEmpty([
    truncate(collapseWhitespace(item.description ?? ""), 220),
    truncate(collapseWhitespace(item.contentText ?? ""), 220),
    truncate(snippet, 220)
  ]).slice(0, 3);
}

function selectEvidenceSentence(item: NormalizedItemRecord): string {
  return truncate(
    collapseWhitespace(item.contentText ?? item.description ?? item.title),
    item.itemKind === "repo" ? 220 : 260
  );
}

function buildTopicPhrase(matchedKeywords: string[]): string | null {
  const ordered = [
    "OpenAI",
    "Codex",
    "GPT",
    "agents",
    "coding agent",
    "MCP",
    "browser automation",
    "evals",
    "security",
    "memory",
    "orchestration",
    "developer tooling"
  ];

  const phrases: string[] = [];
  for (const keyword of ordered) {
    if (!matchedKeywords.includes(keyword)) {
      continue;
    }
    phrases.push(
      {
        OpenAI: "OpenAI 관련 방향성",
        Codex: "Codex / coding workflow",
        GPT: "모델 라인업 변화",
        agents: "agent workflow",
        "coding agent": "coding agent 운영",
        MCP: "MCP interop",
        "browser automation": "browser automation / computer use",
        evals: "eval / benchmark",
        security: "safety / security 운영",
        memory: "memory / state 관리",
        orchestration: "orchestration 설계",
        "developer tooling": "developer tooling"
      }[keyword] ?? keyword
    );
    if (phrases.length >= 2) {
      break;
    }
  }

  return phrases.length > 0 ? phrases.join(" + ") : null;
}

export function assignNumbers(sections: DigestSection[]): void {
  let next = 1;
  for (const section of sections) {
    for (const item of section.items) {
      item.number = next;
      next += 1;
    }
  }
}

function isNotFuture(entry: ScoredItem, windowEnd: DateTime): boolean {
  const published = DateTime.fromISO(entry.item.publishedAt ?? entry.item.lastSeenAt, { zone: "utc" });
  return published <= windowEnd;
}

export function buildThemes(items: DigestEntry[], mode: DigestMode, profileKey: ProfileKey): string[] {
  if (profileKey === "finance") {
    return buildFinanceThemes(items, mode);
  }

  const lowerKeywords = items.flatMap((item) => item.keywords.map((keyword) => keyword.toLowerCase()));
  const bullets: string[] = [];

  if (items.some((item) => item.openaiCategory)) {
    bullets.push("OpenAI 공식 업데이트가 앞단에 많다면, 서드파티 해석보다 실제 API/product/engineering 방향을 먼저 읽는 편이 정확합니다.");
  }

  if (lowerKeywords.some((keyword) => keyword.includes("agents") || keyword.includes("mcp") || keyword.includes("browser"))) {
    bullets.push("agents, MCP, browser automation 계열은 모델 성능 경쟁보다 '실제로 일을 시키는 실행 계층'이 두꺼워지는 방향을 보여줍니다.");
  }

  if (lowerKeywords.some((keyword) => keyword.includes("eval") || keyword.includes("security") || keyword.includes("safety"))) {
    bullets.push("이제 차별점은 모델 하나보다 eval, safety, security 같은 운영 구조에 더 많이 걸립니다.");
  }

  if (items.some((item) => item.sourceLabel.startsWith("GeekNews"))) {
    bullets.push("GeekNews 반응은 한국 개발자들이 무엇을 실제로 써보려 하는지, 어디서 friction을 느끼는지 읽는 보조 신호로 유효합니다.");
  }

  if (items.some((item) => item.sourceLabel.startsWith("Techmeme") || item.scoreReasons.some((reason) => reason.includes("Techmeme")))) {
    bullets.push("Techmeme/HN 같은 precision layer가 붙으면 발표 자체보다 확산 속도와 개발자 반응을 함께 읽어야 합니다.");
  }

  if (mode === "pm" && items.some((item) => item.sectionKey === "repo_radar")) {
    bullets.push("오늘 repo 신호는 단순 인기보다 agent/devtool utility가 있는 실행 계층 프로젝트로 수렴하고 있습니다.");
  }

  return bullets.slice(0, mode === "am" ? 2 : 4);
}

function isToolingMethodsEntry(entry: DigestEntry): boolean {
  const haystack = [
    entry.title,
    entry.summary,
    entry.engineerRelevance ?? "",
    entry.aiEcosystem ?? "",
    entry.trendSignal ?? "",
    entry.keywords.join(" ")
  ]
    .join(" ")
    .toLowerCase();

  return /agents|agentic|mcp|browser automation|computer use|eval|benchmark|orchestration|memory|rag|developer tooling|workflow|sdk|cli/.test(
    haystack
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => collapseWhitespace(value)).filter((value) => value.length > 0))];
}

export function applyThemeSections(sections: DigestSection[], themes: string[], mode: DigestMode, profileKey: ProfileKey): void {
  const themeSectionKey = mode === "pm" ? "what_this_means" : "themes";
  const section = sections.find((candidate) => candidate.key === themeSectionKey);
  if (!section) {
    return;
  }
  section.bullets = themes;
}

function buildFinanceSummary(item: NormalizedItemRecord): string {
  const bucket = financeBucket(item);

  if (item.primarySourceId === "major_company_filings") {
    const company = String(item.metadata.companyName ?? item.title);
    return truncate(`${company}의 공식 공시입니다. 가이던스, 리스크, 자본 배분, AI 투자 신호를 빠르게 확인할 가치가 있습니다.`, 120);
  }

  if (bucket === "inflation") {
    return truncate("인플레이션 경로를 직접 보여주는 공식 지표입니다. 금리 기대와 기업 마진 해석에 바로 연결됩니다.", 120);
  }

  if (bucket === "labor") {
    return truncate("고용과 노동시장 강도를 보여주는 공식 지표입니다. 경기 체력과 금리 해석의 핵심 입력입니다.", 120);
  }

  if (bucket === "regulation") {
    return truncate("정책·규제 방향을 보여주는 공식 발표입니다. 시장 구조와 기업 disclosure 부담에 영향을 줄 수 있습니다.", 120);
  }

  return truncate("거시/정책 방향을 읽는 데 직접 쓰이는 공식 항목입니다. 시장 기대 변화와 같이 봐야 합니다.", 120);
}

function buildFinanceWhyImportant(item: NormalizedItemRecord): string {
  const bucket = financeBucket(item);

  if (bucket === "company") {
    return truncate("공식 공시라 해석 노이즈가 적고, 실적·가이던스·리스크 변화가 valuation 기대를 바로 움직일 수 있습니다.", 110);
  }

  if (bucket === "inflation") {
    return truncate("인플레이션 경로는 금리와 valuation의 공통 분모라서, 하루 흐름보다 더 긴 기간 해석에 중요합니다.", 110);
  }

  if (bucket === "labor") {
    return truncate("고용 지표는 경기 강도와 Fed 경로를 같이 읽게 해줘서, 정책 기대를 재가격할 때 중요합니다.", 110);
  }

  if (bucket === "regulation") {
    return truncate("규제·집행 변화는 시장 구조, 공시 의무, 대형주 리스크 프리미엄에 직접 영향을 줄 수 있습니다.", 110);
  }

  return truncate("시장과 정책 기대가 만나는 공식 신호라서, headline보다 맥락을 같이 읽을 가치가 큽니다.", 110);
}

function buildFinanceThemes(items: DigestEntry[], mode: DigestMode): string[] {
  const buckets = items.map((item) => String(item.metadata.financeBucket ?? ""));
  const bullets: string[] = [];

  if (buckets.some((bucket) => bucket === "inflation" || bucket === "labor")) {
    bullets.push("오늘 금융 브리프는 인플레이션·고용처럼 금리 기대를 직접 흔드는 지표 비중이 높습니다.");
  }

  if (buckets.some((bucket) => bucket === "regulation")) {
    bullets.push("정책·규제 신호가 붙은 날은 headline보다 집행 방향과 disclosure 부담을 같이 읽는 게 중요합니다.");
  }

  if (buckets.some((bucket) => bucket === "company")) {
    bullets.push("대형주 공시는 실적 숫자보다 가이던스, capex, risk factor 변화에 더 주목할 가치가 있습니다.");
  }

  if (mode === "pm" && items.some((item) => item.primaryUrl.includes("sec.gov/Archives/edgar/data"))) {
    bullets.push("PM wrap에서는 macro headline과 company filing을 붙여 봐야 하루 해석이 덜 흔들립니다.");
  }

  return bullets.slice(0, mode === "am" ? 2 : 4);
}

function financeBucket(item: NormalizedItemRecord): string {
  return String(item.metadata.financeBucket ?? "");
}
