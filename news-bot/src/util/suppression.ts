import type { DigestEntry, NormalizedItemRecord, SourceType } from "../types.js";
import { canonicalizeUrl, normalizeTitle, sha256Hex } from "./canonicalize.js";
import { titleSimilarity } from "./dedupe.js";

export interface SuppressionFingerprint {
  canonicalIdentityHash: string;
  storyClusterHash: string;
  titleSnapshot: string;
  urlSnapshot: string;
  repoKey?: string | null;
  normalizedTitle: string;
  titleHash?: string | null;
  sourceType?: SourceType;
}

export interface RecentSentIdentity extends SuppressionFingerprint {
  itemId: number;
  sentAt: string;
  sectionKey?: string | null;
  contentSourceHash?: string | null;
  lastUpdatedSnapshot?: string | null;
}

export function buildSuppressionFingerprint(
  item: Pick<
    NormalizedItemRecord,
    | "canonicalUrl"
    | "title"
    | "normalizedTitle"
    | "titleHash"
    | "repoOwner"
    | "repoName"
    | "sourceType"
    | "primarySourceLabel"
  >
): SuppressionFingerprint {
  const urlSnapshot = canonicalizeUrlSafe(item.canonicalUrl);
  const normalized = item.normalizedTitle || normalizeTitle(item.title);
  const repoKey = item.repoOwner && item.repoName ? `${item.repoOwner}/${item.repoName}`.toLowerCase() : null;
  const storyClusterBase = repoKey
    ? `repo:${repoKey}`
    : item.sourceType === "openai_official"
      ? `openai:${urlSnapshot}`
      : `story:${normalized}`;

  return {
    canonicalIdentityHash: sha256Hex(`canonical:${urlSnapshot}`),
    storyClusterHash: sha256Hex(storyClusterBase),
    titleSnapshot: item.title,
    urlSnapshot,
    repoKey,
    normalizedTitle: normalized,
    titleHash: item.titleHash,
    sourceType: item.sourceType
  };
}

export function buildSuppressionFingerprintFromEntry(entry: DigestEntry): SuppressionFingerprint {
  const urlSnapshot = canonicalizeUrlSafe(entry.primaryUrl);
  const normalized = normalizeTitle(entry.title);
  const repoKey =
    entry.repoLanguage != null && entry.title.includes("/")
      ? entry.title.toLowerCase()
      : inferRepoKeyFromLinks(entry.sourceLinks.map((link) => link.url), entry.title);
  const storyClusterBase = repoKey
    ? `repo:${repoKey}`
    : entry.sourceType === "openai_official"
      ? `openai:${urlSnapshot}`
      : `story:${normalized}`;

  return {
    canonicalIdentityHash: sha256Hex(`canonical:${urlSnapshot}`),
    storyClusterHash: sha256Hex(storyClusterBase),
    titleSnapshot: entry.title,
    urlSnapshot,
    repoKey,
    normalizedTitle: normalized,
    titleHash: null,
    sourceType: entry.sourceType
  };
}

export function findRecentSuppressionMatch(
  current: SuppressionFingerprint,
  recentItems: RecentSentIdentity[]
): { match: RecentSentIdentity; reason: string } | null {
  for (const recent of recentItems) {
    if (current.canonicalIdentityHash === recent.canonicalIdentityHash) {
      return { match: recent, reason: "canonical_identity" };
    }

    if (current.storyClusterHash === recent.storyClusterHash) {
      return { match: recent, reason: "story_cluster" };
    }

    if (current.repoKey && recent.repoKey && current.repoKey === recent.repoKey) {
      return { match: recent, reason: "repo_identity" };
    }

    if (
      current.normalizedTitle.length > 10 &&
      recent.normalizedTitle.length > 10 &&
      titleSimilarity(current.normalizedTitle, recent.normalizedTitle) >= 0.9
    ) {
      return { match: recent, reason: "fuzzy_title" };
    }
  }

  return null;
}

function canonicalizeUrlSafe(input: string): string {
  try {
    return canonicalizeUrl(input);
  } catch {
    return input.trim();
  }
}

function inferRepoKeyFromLinks(urls: string[], fallbackTitle: string): string | null {
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "github.com") {
        continue;
      }
      const parts = parsed.pathname.split("/").filter(Boolean).slice(0, 2);
      if (parts.length === 2) {
        return `${parts[0]}/${parts[1]}`.toLowerCase();
      }
    } catch {
      continue;
    }
  }

  return fallbackTitle.includes("/") ? fallbackTitle.toLowerCase() : null;
}
