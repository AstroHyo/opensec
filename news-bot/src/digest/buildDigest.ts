import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
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
import { truncate } from "../util/text.js";
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

  const emptyHeader = profile.briefTitles[mode];

  if (scored.length === 0) {
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
        includedCount: 0
      }
    };
  }

  const sections =
    profileKey === "finance"
      ? mode === "am"
        ? buildFinanceAmSections(scored)
        : mode === "pm"
          ? buildFinancePmSections(scored)
          : buildManualSections(scored, profileKey)
      : mode === "am"
        ? buildAmSections(scored, profileKey)
        : mode === "pm"
          ? buildPmSections(scored, profileKey)
          : buildManualSections(scored, profileKey);
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
    bodyText: "",
    stats: {
      candidateCount: candidates.length,
      includedCount: items.length
    }
  };

  result.bodyText = renderTelegramDigest(result);
  return result;
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

function buildAmSections(scored: ScoredItem[], profileKey: ProfileKey): DigestSection[] {
  const mustSee = scored.filter((entry) => entry.item.itemKind !== "repo").slice(0, 4);
  const mustSeeIds = new Set(mustSee.map((entry) => entry.item.id));
  const openAiWatch = scored
    .filter((entry) => entry.item.sourceType === "openai_official" && !mustSeeIds.has(entry.item.id))
    .slice(0, 3);
  const openAiIds = new Set(openAiWatch.map((entry) => entry.item.id));
  const repoRadar = scored
    .filter((entry) => entry.item.itemKind === "repo" && !mustSeeIds.has(entry.item.id) && !openAiIds.has(entry.item.id))
    .slice(0, 3);

  return [
    {
      key: "must_see",
      title: "꼭 볼 것",
      items: mustSee.map((entry) => toDigestEntry(entry, "must_see", profileKey))
    },
    {
      key: "openai_watch",
      title: "OpenAI Watch",
      items: openAiWatch.map((entry) => toDigestEntry(entry, "openai_watch", profileKey))
    },
    {
      key: "repo_radar",
      title: "Repo Radar",
      items: repoRadar.map((entry) => toDigestEntry(entry, "repo_radar", profileKey))
    },
    {
      key: "themes",
      title: "오늘 보이는 흐름",
      items: [],
      bullets: []
    }
  ];
}

function buildPmSections(scored: ScoredItem[], profileKey: ProfileKey): DigestSection[] {
  const topDevelopments = scored.filter((entry) => entry.item.itemKind !== "repo").slice(0, 6);
  const topIds = new Set(topDevelopments.map((entry) => entry.item.id));
  const openAiWatch = scored
    .filter((entry) => entry.item.sourceType === "openai_official" && !topIds.has(entry.item.id))
    .slice(0, 4);
  const openAiIds = new Set(openAiWatch.map((entry) => entry.item.id));
  const repoRadar = scored
    .filter((entry) => entry.item.itemKind === "repo" && !topIds.has(entry.item.id) && !openAiIds.has(entry.item.id))
    .slice(0, 5);
  const repoIds = new Set(repoRadar.map((entry) => entry.item.id));
  const tooling = scored
    .filter(
      (entry) =>
        !topIds.has(entry.item.id) &&
        !openAiIds.has(entry.item.id) &&
        !repoIds.has(entry.item.id) &&
        (entry.score.methodologyScore >= 10 || /agents|MCP|browser automation|evals|developer tooling/i.test(entry.score.matchedKeywords.join(" ")))
    )
    .slice(0, 4);

  return [
    {
      key: "top_developments",
      title: "Top developments",
      items: topDevelopments.map((entry) => toDigestEntry(entry, "top_developments", profileKey))
    },
    {
      key: "openai_watch",
      title: "OpenAI Watch",
      items: openAiWatch.map((entry) => toDigestEntry(entry, "openai_watch", profileKey))
    },
    {
      key: "tooling_methods",
      title: "AI Tooling / Methods",
      items: tooling.map((entry) => toDigestEntry(entry, "tooling_methods", profileKey))
    },
    {
      key: "repo_radar",
      title: "Repo Radar",
      items: repoRadar.map((entry) => toDigestEntry(entry, "repo_radar", profileKey))
    },
    {
      key: "what_this_means",
      title: "What this means",
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
  return {
    profileKey,
    number: 0,
    itemId: entry.item.id,
    sectionKey,
    title,
    summary: buildSummary(entry.item, entry.score, profileKey),
    whyImportant: buildWhyImportant(entry.item, entry.score, profileKey),
    contentSnippet: truncate(entry.item.contentText ?? entry.item.description ?? entry.item.title, 220),
    primaryUrl: sourceLinks[0]?.url ?? entry.item.originalUrl ?? entry.item.sourceUrl,
    sourceLabel: entry.item.primarySourceLabel,
    score: Math.round(entry.score.total),
    scoreReasons: entry.score.reasons,
    sourceLinks,
    signalLinks: dedupeSignalLinks(entry.item),
    openaiCategory: entry.item.openaiCategory,
    repoLanguage: entry.item.repoLanguage,
    repoStarsToday: entry.item.repoStarsToday,
    repoStarsTotal: entry.item.repoStarsTotal,
    keywords: entry.score.matchedKeywords,
    description: entry.item.description,
    metadata: entry.item.metadata
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

function assignNumbers(sections: DigestSection[]): void {
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

function buildThemes(items: DigestEntry[], mode: DigestMode, profileKey: ProfileKey): string[] {
  if (profileKey === "finance") {
    return buildFinanceThemes(items, mode);
  }

  const lowerKeywords = items.flatMap((item) => item.keywords.map((keyword) => keyword.toLowerCase()));
  const bullets: string[] = [];

  if (items.some((item) => item.openaiCategory)) {
    bullets.push("OpenAI 공식 업데이트 비중이 높아 오늘 digest도 공식 신호 우선 해석이 맞습니다.");
  }

  if (lowerKeywords.some((keyword) => keyword.includes("agents") || keyword.includes("mcp") || keyword.includes("browser"))) {
    bullets.push("agents / MCP / browser automation 쪽으로 '도구를 실제로 움직이는' 스택이 계속 강합니다.");
  }

  if (lowerKeywords.some((keyword) => keyword.includes("eval") || keyword.includes("security") || keyword.includes("safety"))) {
    bullets.push("출시 뉴스만큼 eval, safety, security 운영 방식이 같이 중요해지는 흐름이 보입니다.");
  }

  if (items.some((item) => item.sourceLabel.startsWith("GeekNews"))) {
    bullets.push("GeekNews가 한국 개발자 커뮤니티의 실전형 tooling 관심사를 보조 신호로 잘 보여줍니다.");
  }

  if (items.some((item) => item.sourceLabel.startsWith("Techmeme") || item.scoreReasons.some((reason) => reason.includes("Techmeme")))) {
    bullets.push("Techmeme/HN 같은 precision layer가 붙은 항목은 시장 확산과 개발자 반응을 함께 확인할 가치가 큽니다.");
  }

  if (mode === "pm" && items.some((item) => item.sectionKey === "repo_radar")) {
    bullets.push("오늘의 Repo Radar는 단순 인기보다 agent/devtool utility가 있는 프로젝트 위주로 압축됐습니다.");
  }

  return bullets.slice(0, mode === "am" ? 2 : 4);
}

function applyThemeSections(sections: DigestSection[], themes: string[], mode: DigestMode, profileKey: ProfileKey): void {
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
