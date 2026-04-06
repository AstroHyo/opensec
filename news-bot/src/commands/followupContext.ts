import type { DigestEntry, SavedDigestRecord } from "../types.js";
import { uniqueStrings } from "../util/text.js";
import type { FollowupSourceFilter } from "./followupIntent.js";

const STOPWORDS = new Set([
  "ask",
  "research",
  "news",
  "뉴스",
  "오늘",
  "설명",
  "설명해줘",
  "요약",
  "요약해줘",
  "정리",
  "정리해줘",
  "알려줘",
  "다시",
  "관련",
  "관점",
  "우리",
  "제품",
  "서비스",
  "찾아봐",
  "조사해줘",
  "최신",
  "반응",
  "공식",
  "의미"
]);

export function selectRelevantItems(input: {
  digest: SavedDigestRecord;
  question: string;
  referencedNumbers: number[];
  sourceFilter?: FollowupSourceFilter;
}): DigestEntry[] {
  const byNumbers = input.referencedNumbers
    .map((number) => input.digest.items.find((item) => item.number === number))
    .filter((item): item is DigestEntry => Boolean(item));

  if (byNumbers.length > 0) {
    return byNumbers;
  }

  const scopedItems = applySourceFilter(input.digest.items, input.sourceFilter);
  const tokens = extractQueryTokens(input.question);
  const scored = scopedItems
    .map((item) => ({ item, score: computeItemRelevanceScore(item, tokens, input.question.toLowerCase()) }))
    .sort((left, right) => right.score - left.score || left.item.number - right.item.number);

  const matched = scored.filter((candidate) => candidate.score > 0).map((candidate) => candidate.item).slice(0, 4);
  if (matched.length > 0) {
    return matched;
  }

  return scopedItems.slice(0, Math.min(scopedItems.length, input.sourceFilter ? 4 : 2));
}

export function summarizeSources(items: DigestEntry[], usedNumbers: number[]): string[] {
  const allowed = new Set(usedNumbers);
  return uniqueStrings(
    items
      .filter((item) => allowed.has(item.number))
      .flatMap((item) => [
        ...item.sourceLinks.map((source) => source.label),
        ...(item.signalLinks ?? []).map((signal) => signal.label)
      ])
  ).slice(0, 4);
}

function applySourceFilter(items: DigestEntry[], sourceFilter?: FollowupSourceFilter): DigestEntry[] {
  if (sourceFilter === "openai") {
    const selected = items.filter((item) => Boolean(item.openaiCategory) || item.sourceLabel.toLowerCase().includes("openai"));
    return selected.length > 0 ? selected : items;
  }

  if (sourceFilter === "repo_radar") {
    const selected = items.filter((item) => item.repoStarsToday != null);
    return selected.length > 0 ? selected : items;
  }

  return items;
}

function extractQueryTokens(question: string): string[] {
  return uniqueStrings(
    question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 2 && !STOPWORDS.has(value))
  );
}

function computeItemRelevanceScore(item: DigestEntry, tokens: string[], questionLower: string): number {
  const haystack = [
    item.title,
    item.summary,
    item.whyImportant,
    item.sourceLabel,
    item.openaiCategory ?? "",
    item.keywords.join(" "),
    item.scoreReasons.join(" "),
    (item.signalLinks ?? []).map((signal) => signal.label).join(" ")
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 3 : 1;
    }
    if (item.title.toLowerCase().includes(token)) {
      score += 2;
    }
  }

  if (questionLower.includes("openai") && item.openaiCategory) {
    score += 4;
  }

  if (
    (questionLower.includes("repo") ||
      questionLower.includes("레포") ||
      questionLower.includes("github") ||
      questionLower.includes("깃허브") ||
      questionLower.includes("trending")) &&
    item.repoStarsToday != null
  ) {
    score += 4;
  }

  return score;
}
