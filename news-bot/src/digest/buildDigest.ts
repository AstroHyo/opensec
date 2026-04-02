import { DateTime } from "luxon";
import type { AppConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import { isRelevantRepo, scoreItem } from "../scoring.js";
import type {
  DigestBuildResult,
  DigestEntry,
  DigestMode,
  DigestSection,
  NormalizedItemRecord,
  ScoreBreakdown
} from "../types.js";
import { resolveDigestWindow } from "../util/timeWindow.js";
import { truncate } from "../util/text.js";
import { renderTelegramDigest } from "./renderTelegram.js";

interface BuildDigestParams {
  db: NewsDatabase;
  config: AppConfig;
  mode: DigestMode;
  now: DateTime;
}

interface ScoredItem {
  item: NormalizedItemRecord;
  score: ScoreBreakdown;
}

export function buildDigest({ db, config, mode, now }: BuildDigestParams): DigestBuildResult {
  const lastAmDigest = db.getLatestDigest("am");
  const lastPmDigest = db.getLatestDigest("pm");
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
  const candidates = db.listCandidateItems(lookbackStart);

  const scored = candidates
    .map((item) => ({
      item,
      score: scoreItem(item, {
        mode,
        now: now.toUTC(),
        windowStart,
        windowEnd,
        resendHours: 72
      })
    }))
    .filter((entry) => isNotFuture(entry, windowEnd))
    .filter((entry) => includeItem(entry, mode))
    .sort(sortScoredItems);

  const emptyHeader = mode === "am" ? "AM AI Brief" : mode === "pm" ? "PM AI Wrap" : "Manual AI Brief";

  if (scored.length === 0) {
    const header = `[${emptyHeader} | ${window.dateLabel} ET]`;
    return {
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

  const sections = mode === "am" ? buildAmSections(scored) : mode === "pm" ? buildPmSections(scored) : buildManualSections(scored);
  assignNumbers(sections);
  const items = sections.flatMap((section) => section.items);
  const themes = buildThemes(items, mode);
  applyThemeSections(sections, themes, mode);

  const header = `[${emptyHeader} | ${window.dateLabel} ET]`;
  const result: DigestBuildResult = {
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

function includeItem(entry: ScoredItem, mode: DigestMode): boolean {
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

function sortScoredItems(left: ScoredItem, right: ScoredItem): number {
  if (right.score.total !== left.score.total) {
    return right.score.total - left.score.total;
  }

  const rightTime = DateTime.fromISO(right.item.publishedAt ?? right.item.lastSeenAt, { zone: "utc" }).toMillis();
  const leftTime = DateTime.fromISO(left.item.publishedAt ?? left.item.lastSeenAt, { zone: "utc" }).toMillis();
  return rightTime - leftTime;
}

function buildAmSections(scored: ScoredItem[]): DigestSection[] {
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
      items: mustSee.map((entry) => toDigestEntry(entry, "must_see"))
    },
    {
      key: "openai_watch",
      title: "OpenAI Watch",
      items: openAiWatch.map((entry) => toDigestEntry(entry, "openai_watch"))
    },
    {
      key: "repo_radar",
      title: "Repo Radar",
      items: repoRadar.map((entry) => toDigestEntry(entry, "repo_radar"))
    },
    {
      key: "themes",
      title: "오늘 보이는 흐름",
      items: [],
      bullets: []
    }
  ];
}

function buildPmSections(scored: ScoredItem[]): DigestSection[] {
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
      items: topDevelopments.map((entry) => toDigestEntry(entry, "top_developments"))
    },
    {
      key: "openai_watch",
      title: "OpenAI Watch",
      items: openAiWatch.map((entry) => toDigestEntry(entry, "openai_watch"))
    },
    {
      key: "tooling_methods",
      title: "AI Tooling / Methods",
      items: tooling.map((entry) => toDigestEntry(entry, "tooling_methods"))
    },
    {
      key: "repo_radar",
      title: "Repo Radar",
      items: repoRadar.map((entry) => toDigestEntry(entry, "repo_radar"))
    },
    {
      key: "what_this_means",
      title: "What this means",
      items: [],
      bullets: []
    }
  ];
}

function buildManualSections(scored: ScoredItem[]): DigestSection[] {
  const highlights = scored.slice(0, 8);
  return [
    {
      key: "highlights",
      title: "Highlights",
      items: highlights.map((entry) => toDigestEntry(entry, "highlights"))
    }
  ];
}

function toDigestEntry(entry: ScoredItem, sectionKey: string): DigestEntry {
  const sourceLinks = dedupeSourceLinks(entry.item);
  const title = entry.item.repoName && entry.item.repoOwner ? `${entry.item.repoOwner}/${entry.item.repoName}` : entry.item.title;
  return {
    number: 0,
    itemId: entry.item.id,
    sectionKey,
    title,
    summary: buildSummary(entry.item, entry.score),
    whyImportant: buildWhyImportant(entry.item, entry.score),
    contentSnippet: truncate(entry.item.contentText ?? entry.item.description ?? entry.item.title, 220),
    primaryUrl: sourceLinks[0]?.url ?? entry.item.originalUrl ?? entry.item.sourceUrl,
    sourceLabel: entry.item.primarySourceLabel,
    score: Math.round(entry.score.total),
    scoreReasons: entry.score.reasons,
    sourceLinks,
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
  const seen = new Set<string>();
  const links: Array<{ label: string; url: string }> = [];

  for (const source of item.sources) {
    const url = source.originalUrl ?? source.sourceUrl;
    if (!seen.has(url)) {
      seen.add(url);
      links.push({ label: source.sourceLabel, url });
    }
  }

  if (links.length === 0) {
    links.push({ label: item.primarySourceLabel, url: item.originalUrl ?? item.sourceUrl });
  }

  return links;
}

function buildSummary(item: NormalizedItemRecord, score: ScoreBreakdown): string {
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

  return truncate(`${topicPhrase ?? "실무 영향이 있는 신호"}를 중심으로 본 항목입니다.`, 120);
}

function buildWhyImportant(item: NormalizedItemRecord, score: ScoreBreakdown): string {
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

function buildThemes(items: DigestEntry[], mode: DigestMode): string[] {
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

  if (mode === "pm" && items.some((item) => item.sectionKey === "repo_radar")) {
    bullets.push("오늘의 Repo Radar는 단순 인기보다 agent/devtool utility가 있는 프로젝트 위주로 압축됐습니다.");
  }

  return bullets.slice(0, mode === "am" ? 2 : 4);
}

function applyThemeSections(sections: DigestSection[], themes: string[], mode: DigestMode): void {
  const themeSectionKey = mode === "pm" ? "what_this_means" : "themes";
  const section = sections.find((candidate) => candidate.key === themeSectionKey);
  if (!section) {
    return;
  }
  section.bullets = themes;
}
