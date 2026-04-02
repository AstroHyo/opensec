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
      lines.push(formatItemLine(item));
      lines.push(`한줄 요약: ${collapseWhitespace(item.summary)}`);
      lines.push(`왜 중요한지: ${collapseWhitespace(item.whyImportant)}`);
      lines.push(`출처: ${item.sourceLabel}`);
      lines.push(`링크: ${item.primaryUrl}`);
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
