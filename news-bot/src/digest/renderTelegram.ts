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

  if (item.openAiAngle) {
    lines.push(`OpenAI 각도: ${collapseWhitespace(item.openAiAngle)}`);
  }

  lines.push(`변화 신호: ${collapseWhitespace(item.trendSignal ?? item.causeEffect ?? item.whyImportant)}`);
  lines.push(`링크: ${item.primaryUrl}`);
  return lines;
}
