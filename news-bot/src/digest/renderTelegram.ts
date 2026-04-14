import type { DigestBuildResult, DigestEntry } from "../types.js";
import { collapseWhitespace } from "../util/text.js";

export function renderTelegramDigest(result: DigestBuildResult): string {
  const lines: string[] = [result.header, ""];
  let sectionIndex = 1;

  for (const section of result.sections) {
    if (section.items.length === 0 && (!section.bullets || section.bullets.length === 0)) {
      continue;
    }

    lines.push(`${sectionIndex}) ${section.title}`);
    sectionIndex += 1;

    for (const item of section.items) {
      lines.push(...formatItemBlock(item));
      lines.push("");
    }

    if (section.bullets?.length) {
      for (const bullet of section.bullets) {
        lines.push(`- ${collapseWhitespace(bullet)}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

export function escapeTelegramMarkdownV2(value: string): string {
  return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export function renderTelegramMarkdownV2(result: DigestBuildResult): string {
  return escapeTelegramMarkdownV2(renderTelegramDigest(result));
}

function formatItemLine(item: DigestEntry): string {
  if (item.repoStarsToday != null) {
    const lang = item.repoLanguage ?? "n/a";
    return `[${item.number}] ${item.title} | ${lang} | +${item.repoStarsToday} today`;
  }
  return `[${item.number}] ${item.title}`;
}

function formatItemBlock(item: DigestEntry): string[] {
  if (item.profileKey === "finance") {
    return [
      formatItemLine(item),
      `한줄 요약: ${collapseWhitespace(item.summary)}`,
      `왜 중요한지: ${collapseWhitespace(item.whyImportant)}`,
      `출처: ${item.sourceLabel}`,
      `링크: ${item.primaryUrl}`
    ];
  }

  const lines = [
    formatItemLine(item),
    `무슨 일: ${collapseWhitespace(item.whatChanged ?? item.summary)}`,
    `엔지니어 관점: ${collapseWhitespace(item.engineerRelevance ?? item.whyImportant)}`,
    `AI 맥락: ${collapseWhitespace(item.aiEcosystem ?? item.whyImportant)}`
  ];

  const openAiAngle = selectOpenAiAngle(item);
  if (openAiAngle) {
    lines.push(`OpenAI 각도: ${openAiAngle}`);
  }

  lines.push(`변화 신호: ${pickChangeSignal(item)}`);
  lines.push(`링크: ${item.primaryUrl}`);
  return lines;
}

function pickChangeSignal(item: DigestEntry): string {
  const trendSignal = collapseWhitespace(item.trendSignal ?? "");
  const causeEffect = collapseWhitespace(item.causeEffect ?? "");

  if (!trendSignal) {
    return causeEffect || collapseWhitespace(item.whyImportant);
  }

  if (causeEffect && isGenericSignal(trendSignal)) {
    return causeEffect;
  }

  return trendSignal;
}

function selectOpenAiAngle(item: DigestEntry): string | null {
  const candidate = collapseWhitespace(item.openAiAngle ?? "");
  if (!candidate) {
    return null;
  }

  const comparisonTargets = [
    item.whatChanged ?? item.summary,
    item.engineerRelevance ?? item.whyImportant,
    item.aiEcosystem ?? "",
    pickChangeSignal(item)
  ];

  const redundant = comparisonTargets.some((target) => similarityScore(candidate, target) >= 0.74);
  if (redundant) {
    return null;
  }

  if (/핵심입니다\.?$/.test(candidate) && similarityScore(candidate, item.whatChanged ?? item.summary) >= 0.55) {
    return null;
  }

  return candidate;
}

function isGenericSignal(value: string): boolean {
  return /(흐름입니다|추세입니다|방향입니다|방향성|자리잡|보여줍니다|재정렬|촉진합니다|표준화|진화하고|반영합니다)/.test(value);
}

function similarityScore(left: string, right: string): number {
  const leftTokens = tokenizeForComparison(left);
  const rightTokens = tokenizeForComparison(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function tokenizeForComparison(value: string): Set<string> {
  return new Set(
    collapseWhitespace(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter((token) => !["openai", "official", "update", "이번", "항목", "공식", "핵심", "입니다"].includes(token))
  );
}
