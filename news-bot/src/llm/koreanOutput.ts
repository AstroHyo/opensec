import type { DigestEntry } from "../types.js";
import { collapseWhitespace, truncate } from "../util/text.js";

const BOILERPLATE_PATTERNS = [
  /엔지니어 관점에서는 기능 발표 자체보다 실제 workflow/i,
  /제품 기능보다 실행 계층[, ]*운영 방법[, ]*개발자 경험 중심/i,
  /핵심 흐름은 모델 그 자체보다 .* 실행 계층이 두꺼워지는/i,
  /생태계가 재정렬/i,
  /중요한 신호/i,
  /촉진합니다/i,
  /보여줍니다/i
];

export function preferKoreanNarrative(candidate: string | null | undefined, fallback: string, maxLength: number): string {
  const normalizedFallback = truncate(collapseWhitespace(fallback), maxLength);
  const normalizedCandidate = truncate(stripEnglishSentenceSegments(collapseWhitespace(candidate ?? "")), maxLength);

  if (!normalizedCandidate) {
    return normalizedFallback;
  }

  if (isBoilerplateNarrative(normalizedCandidate) || looksMostlyEnglishNarrative(normalizedCandidate)) {
    return normalizedFallback;
  }

  return normalizedCandidate;
}

export function preferOptionalKoreanNarrative(candidate: string | null | undefined, maxLength: number): string | null {
  const normalizedCandidate = truncate(stripEnglishSentenceSegments(collapseWhitespace(candidate ?? "")), maxLength);
  if (!normalizedCandidate) {
    return null;
  }

  if (isBoilerplateNarrative(normalizedCandidate) || looksMostlyEnglishNarrative(normalizedCandidate)) {
    return null;
  }

  return normalizedCandidate;
}

export function sanitizeNarrativeList(values: string[] | null | undefined, maxItems: number, maxLength: number): string[] {
  return (values ?? [])
    .map((value) => truncate(stripEnglishSentenceSegments(collapseWhitespace(value)), maxLength))
    .filter((value) => value.length > 0)
    .filter((value) => !looksMostlyEnglishNarrative(value))
    .slice(0, maxItems);
}

export function sanitizeThemeBullets(candidates: string[], fallbacks: string[], maxItems: number, maxLength: number): string[] {
  const sanitized = candidates
    .map((candidate, index) => preferKoreanNarrative(candidate, fallbacks[index] ?? fallbacks[0] ?? "", maxLength))
    .filter((value) => value.length > 0);

  if (sanitized.length > 0) {
    return uniqueStringsPreservingOrder(sanitized).slice(0, maxItems);
  }

  return uniqueStringsPreservingOrder(
    fallbacks
      .map((value) => truncate(collapseWhitespace(value), maxLength))
      .filter((value) => value.length > 0)
  ).slice(0, maxItems);
}

export function buildRepoUseCaseFallback(item: DigestEntry): string | null {
  if (item.itemKind !== "repo") {
    return null;
  }

  const label = item.title;
  const text = collapseWhitespace(
    `${item.title} ${item.summary ?? ""} ${item.description ?? ""} ${(item.themeTags ?? []).join(" ")} ${item.keywords.join(" ")}`
  ).toLowerCase();

  let effect = "반복 작업을 별도 에이전트 단계로 떼어내고 운영 자동화를 더 촘촘하게 붙일 수 있습니다.";

  if (/(mcp|tool calling|tool-use|tools)/i.test(text)) {
    effect = "도구 연결과 권한 경계를 표준화해 OpenSec workflow에서 agent command 조립 시간을 줄일 수 있습니다.";
  } else if (/(browser|playwright|computer use|automation)/i.test(text)) {
    effect = "브라우저 기반 후속 작업을 OpenSec follow-up이나 운영 점검 자동화에 붙여 반복 클릭 작업을 줄일 수 있습니다.";
  } else if (/(memory|context|session|mem)/i.test(text)) {
    effect = "세션 문맥과 작업 기억을 누적해 OpenSec follow-up 품질과 장기 작업 연속성을 높일 수 있습니다.";
  } else if (/(eval|benchmark|judge|grading)/i.test(text)) {
    effect = "Digest와 follow-up 결과를 평가 루프에 붙여 품질 회귀를 더 빨리 잡을 수 있습니다.";
  } else if (/(agent|orchestr|workflow|runtime)/i.test(text)) {
    effect = "OpenSec 같은 개인 운영 스택에서 다단계 agent workflow를 더 작게 쪼개고 실행 경계를 분리하는 데 쓸 수 있습니다.";
  }

  return truncate(`OpenSec 같은 개인 운영 스택에서는 ${label}를 별도 실험 흐름에 붙여 ${effect}`, 240);
}

export function looksMostlyEnglishNarrative(value: string): boolean {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return false;
  }

  const hangulChars = (normalized.match(/[가-힣]/g) ?? []).length;
  const latinWords = (normalized.match(/\b[A-Za-z][A-Za-z0-9+./_-]*\b/g) ?? []).filter((token) => token.length >= 2).length;
  const latinChars = (normalized.match(/[A-Za-z]/g) ?? []).length;

  if (hangulChars === 0 && latinWords >= 4) {
    return true;
  }

  if (hangulChars < 8 && latinWords >= 5) {
    return true;
  }

  return latinChars > hangulChars * 1.8 && latinWords >= 6;
}

export function isBoilerplateNarrative(value: string): boolean {
  const normalized = collapseWhitespace(value);
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stripEnglishSentenceSegments(value: string): string {
  const segments = value.split(/(?<=[.!?])\s+/);
  const kept = segments.filter((segment) => !isStandaloneEnglishSentence(segment));
  return collapseWhitespace(kept.join(" "));
}

function isStandaloneEnglishSentence(segment: string): boolean {
  const normalized = segment.trim().replace(/^[\s\-:;,.]+/, "").replace(/[\s\-:;,.]+$/, "");
  if (!normalized) {
    return false;
  }

  const hangulChars = (normalized.match(/[가-힣]/g) ?? []).length;
  const englishWords = (normalized.match(/\b[A-Za-z][A-Za-z0-9+./_-]*\b/g) ?? []).length;
  return hangulChars === 0 && englishWords >= 4;
}

function uniqueStringsPreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }

  return unique;
}
