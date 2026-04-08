import { DateTime } from "luxon";
import { loadConfig } from "../config.js";
import { NewsDatabase } from "../db.js";
import type { DigestEntry, ProfileKey } from "../types.js";
import { answerAskFollowup } from "./followupAnswer.js";
import { classifyFollowupIntent } from "./followupIntent.js";
import { answerResearchFollowup } from "./followupResearch.js";
import { runDigestFlow } from "./runDigest.js";

export async function runFollowupCommand(input: {
  profileKey?: ProfileKey;
  command: string;
  nowIso?: string;
  dbPathOverride?: string;
}): Promise<string> {
  const rawCommand = collapseInput(input.command);
  const command = normalizeCommand(rawCommand);
  const config = loadConfig(process.cwd());
  const profileKey = input.profileKey ?? config.defaultProfile;
  const db = new NewsDatabase(input.dbPathOverride ?? config.dbPath);
  const now = input.nowIso
    ? DateTime.fromISO(input.nowIso, { zone: config.timezone }).setZone(config.timezone)
    : DateTime.now().setZone(config.timezone);

  try {
    if (command === "brief now") {
      return await renderFreshDigest(profileKey, now.hour < 15 ? "am" : "pm", input);
    }
    if (command === "am brief now") {
      return await renderFreshDigest(profileKey, "am", input);
    }
    if (command === "pm brief now") {
      return await renderFreshDigest(profileKey, "pm", input);
    }
    const deterministic = tryDeterministicCommand(command, profileKey, db);
    if (deterministic) {
      return deterministic;
    }

    const intent = classifyFollowupIntent(rawCommand);
    if (intent.kind === "deterministic_command") {
      const routed = tryDeterministicCommand(intent.command, profileKey, db);
      if (routed) {
        return routed;
      }
    }

    if (intent.kind === "ask") {
      return await answerAskFollowup({
        db,
        config,
        profileKey,
        question: intent.question,
        now,
        referencedNumbers: intent.referencedNumbers,
        sourceFilter: intent.sourceFilter,
        comparisonRequested: intent.comparisonRequested
      });
    }

    if (intent.kind === "research") {
      return await answerResearchFollowup({
        db,
        config,
        profileKey,
        question: intent.question,
        now,
        referencedNumbers: intent.referencedNumbers,
        sourceFilter: intent.sourceFilter
      });
    }

    return [
      "지원 명령:",
      "- brief now",
      "- am brief now",
      "- pm brief now",
      "- openai only",
      "- repo radar",
      "- expand N",
      "- show sources for N",
      "- why important N",
      "- today themes",
      "- ask <질문>",
      "- research <질문>"
    ].join("\n");
  } finally {
    db.close();
  }
}

function collapseInput(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/^\//, "").toLowerCase();
}

function tryDeterministicCommand(command: string, profileKey: ProfileKey, db: NewsDatabase): string | null {
  if (command === "openai only") {
    return renderSubset("OpenAI only", ensureLatestDigestItems(profileKey, db), (item) => Boolean(item.openaiCategory));
  }
  if (command === "repo radar") {
    return renderSubset("Repo Radar", ensureLatestDigestItems(profileKey, db), (item) => item.repoStarsToday != null);
  }
  if (command === "today themes") {
    const digest = db.getLatestDigest(profileKey);
    return digest?.themes.length
      ? `[Today themes]\n\n${digest.themes.map((theme) => `- ${theme}`).join("\n")}`
      : "최근 digest theme 정보가 없습니다. 먼저 `brief now`를 실행하세요.";
  }

  const expandMatch = command.match(/^expand\s+(\d+)$/);
  if (expandMatch) {
    const item = db.getFollowupContext(profileKey, Number.parseInt(expandMatch[1], 10));
    return item ? renderExpandedItem(item) : notFound(expandMatch[1]);
  }

  const sourceMatch = command.match(/^show sources for\s+(\d+)$/);
  if (sourceMatch) {
    const item = db.getFollowupContext(profileKey, Number.parseInt(sourceMatch[1], 10));
    return item ? renderSources(item) : notFound(sourceMatch[1]);
  }

  const whyMatch = command.match(/^why important\s+(\d+)$/);
  if (whyMatch) {
    const item = db.getFollowupContext(profileKey, Number.parseInt(whyMatch[1], 10));
    return item ? renderWhyImportant(item) : notFound(whyMatch[1]);
  }

  return null;
}

function ensureLatestDigestItems(profileKey: ProfileKey, db: NewsDatabase): DigestEntry[] {
  const latest = db.getLatestDigest(profileKey);
  return latest?.items ?? [];
}

function renderSubset(title: string, items: DigestEntry[], predicate: (item: DigestEntry) => boolean): string {
  const selected = items.filter(predicate);
  if (selected.length === 0) {
    return `${title}로 보여줄 저장된 항목이 없습니다. 먼저 \`brief now\`를 실행하세요.`;
  }

  return [
    `[${title}]`,
    "",
    ...selected.map((item) =>
      [
        `[${item.number}] ${item.title}`,
        `한줄 요약: ${item.summary}`,
        `출처: ${item.sourceLabel}`,
        `링크: ${item.primaryUrl}`
      ].join("\n")
    )
  ].join("\n\n");
}

function renderExpandedItem(item: DigestEntry): string {
  return [
    `[Expand ${item.number}] ${item.title}`,
    "",
    `한줄 요약: ${item.summary}`,
    `왜 중요한지: ${item.whyImportant}`,
    item.uncertaintyNotes?.length ? `불확실성 메모: ${item.uncertaintyNotes.join(" / ")}` : null,
    `점수 근거: ${item.scoreReasons.join(" / ")}`,
    item.signalLinks?.length ? `추가 신호: ${item.signalLinks.map((signal) => signal.label).join(" / ")}` : null,
    `설명: ${item.description ?? "추가 설명 없음"}`,
    `주요 링크: ${item.primaryUrl}`
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function renderSources(item: DigestEntry): string {
  return [
    `[Sources for ${item.number}] ${item.title}`,
    "",
    "기본 출처:",
    "",
    ...item.sourceLinks.map((source, index) => `${index + 1}. ${source.label}\n${source.url}`),
    item.signalLinks?.length ? "" : null,
    item.signalLinks?.length ? "추가 신호:" : null,
    item.signalLinks?.length
      ? item.signalLinks.map((signal, index) => `${index + 1}. ${signal.label}\n${signal.url}`).join("\n\n")
      : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

function renderWhyImportant(item: DigestEntry): string {
  return [
    `[Why important ${item.number}] ${item.title}`,
    "",
    item.whyImportant,
    "",
    `점수 근거: ${item.scoreReasons.join(" / ")}`
  ].join("\n");
}

function notFound(index: string): string {
  return `최근 digest에서 ${index}번 항목을 찾지 못했습니다.`;
}

async function renderFreshDigest(
  profileKey: ProfileKey,
  mode: "am" | "pm",
  input: { nowIso?: string; dbPathOverride?: string }
): Promise<string> {
  const { digest, db } = await runDigestFlow({
    profileKey,
    mode,
    nowIso: input.nowIso,
    dbPathOverride: input.dbPathOverride
  });
  db.close();
  return digest.bodyText;
}
