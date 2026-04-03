import { collapseWhitespace } from "../util/text.js";

export type FollowupSourceFilter = "openai" | "repo_radar";

export type FollowupIntent =
  | { kind: "deterministic_command"; command: string }
  | {
      kind: "ask";
      question: string;
      referencedNumbers: number[];
      sourceFilter?: FollowupSourceFilter;
      comparisonRequested: boolean;
    }
  | {
      kind: "research";
      question: string;
      referencedNumbers: number[];
      sourceFilter?: FollowupSourceFilter;
    }
  | { kind: "unknown" };

const EXACT_COMMANDS = new Set([
  "brief now",
  "am brief now",
  "pm brief now",
  "openai only",
  "repo radar",
  "today themes"
]);

const RESEARCH_TRIGGER_PATTERNS = [/^research(?:\s|:|-|$)/i, /\b(search|research)\b/i, /더\s*찾아/, /조사해/, /최신\s*정보/, /최신\s*반응/];
const DETAIL_PATTERNS = ["자세", "설명", "expand", "detail", "details", "풀어"];
const SOURCE_PATTERNS = ["출처", "source", "sources", "링크"];
const WHY_PATTERNS = ["왜 중요", "why important", "의미", "임팩트", "impact"];
const THEME_PATTERNS = ["today themes", "오늘 흐름", "오늘 테마", "오늘 themes", "흐름 다시", "what this means"];
const OPENAI_ONLY_PATTERNS = ["openai only", "openai만", "openai 뉴스만", "openai 관련만"];
const REPO_RADAR_PATTERNS = ["repo radar", "레포 레이더", "repo만", "github trending", "깃허브 trending", "trending repo"];

export function classifyFollowupIntent(input: string): FollowupIntent {
  const raw = normalizeInput(input);
  if (!raw) {
    return { kind: "unknown" };
  }

  const normalized = raw.toLowerCase();
  if (EXACT_COMMANDS.has(normalized)) {
    return { kind: "deterministic_command", command: normalized };
  }

  const aliasCommand = matchNaturalLanguageCommand(raw, normalized);
  if (aliasCommand) {
    return { kind: "deterministic_command", command: aliasCommand };
  }

  const referencedNumbers = parseReferencedNumbers(raw);
  const sourceFilter = detectSourceFilter(normalized);

  const researchQuestion = stripModePrefix(raw, "research");
  if (researchQuestion || RESEARCH_TRIGGER_PATTERNS.some((pattern) => pattern.test(raw))) {
    return {
      kind: "research",
      question: researchQuestion ?? raw,
      referencedNumbers,
      sourceFilter
    };
  }

  const askQuestion = stripModePrefix(raw, "ask");
  return {
    kind: "ask",
    question: askQuestion ?? raw,
    referencedNumbers,
    sourceFilter,
    comparisonRequested: isComparisonRequest(normalized, referencedNumbers)
  };
}

function normalizeInput(input: string): string {
  return collapseWhitespace(input.trim().replace(/^\//, ""));
}

function stripModePrefix(input: string, mode: "ask" | "research"): string | null {
  const matched = input.match(new RegExp(`^${mode}\\s*[:\\-]?\\s*(.+)$`, "i"));
  if (!matched?.[1]) {
    return null;
  }

  const question = collapseWhitespace(matched[1]);
  return question.length > 0 ? question : null;
}

function matchNaturalLanguageCommand(raw: string, normalized: string): string | null {
  const numbers = parseReferencedNumbers(raw);
  const firstNumber = numbers[0];

  if (firstNumber) {
    if (SOURCE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return `show sources for ${firstNumber}`;
    }
    if (WHY_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return `why important ${firstNumber}`;
    }
    if (DETAIL_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return `expand ${firstNumber}`;
    }
  }

  if (THEME_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return "today themes";
  }

  if (OPENAI_ONLY_PATTERNS.some((pattern) => normalized.includes(pattern)) && hasShowLikeLanguage(normalized)) {
    return "openai only";
  }

  if (REPO_RADAR_PATTERNS.some((pattern) => normalized.includes(pattern)) && hasShowLikeLanguage(normalized)) {
    return "repo radar";
  }

  return null;
}

function hasShowLikeLanguage(normalized: string): boolean {
  const showLike = ["보여", "only", "리스트", "목록", "show", "나열"].some((pattern) => normalized.includes(pattern));
  const askLike = ["요약", "정리", "설명", "관점", "의미", "왜"].some((pattern) => normalized.includes(pattern));
  return showLike && !askLike;
}

function detectSourceFilter(normalized: string): FollowupSourceFilter | undefined {
  if (normalized.includes("openai")) {
    return "openai";
  }

  if (
    normalized.includes("repo radar") ||
    normalized.includes("레포") ||
    normalized.includes("github") ||
    normalized.includes("깃허브") ||
    normalized.includes("trending")
  ) {
    return "repo_radar";
  }

  return undefined;
}

function isComparisonRequest(normalized: string, referencedNumbers: number[]): boolean {
  if (referencedNumbers.length >= 2) {
    return true;
  }

  return ["차이", "비교", "vs", "versus", "compare"].some((pattern) => normalized.includes(pattern));
}

export function parseReferencedNumbers(input: string): number[] {
  const numbers: number[] = [];

  for (const match of input.matchAll(/(\d+)\s*(?:번|번뉴스|번항목|번 기사|item)?/gi)) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0 && !numbers.includes(parsed)) {
      numbers.push(parsed);
    }
  }

  return numbers;
}
