import type { AppConfig } from "../config.js";
import type { BlueskyWatchActor, SignalEventInput } from "../types.js";
import { canonicalizeUrl } from "../util/canonicalize.js";
import { fetchJson } from "../util/http.js";
import { collapseWhitespace, truncate, uniqueStrings } from "../util/text.js";

interface BlueskyAuthorFeedResponse {
  feed?: BlueskyFeedItem[];
  cursor?: string;
}

interface BlueskyFeedItem {
  post?: {
    uri?: string;
    author?: {
      handle?: string;
      displayName?: string;
      did?: string;
    };
    record?: {
      text?: string;
      createdAt?: string;
      facets?: Array<{
        features?: Array<{ $type?: string; uri?: string }>;
      }>;
    };
    embed?: {
      $type?: string;
      external?: {
        uri?: string;
      };
    };
    bookmarkCount?: number;
    replyCount?: number;
    repostCount?: number;
    likeCount?: number;
    quoteCount?: number;
    indexedAt?: string;
  };
}

const SOCIAL_HOSTS = new Set(["bsky.app", "techmeme.com", "www.techmeme.com", "twitter.com", "x.com", "threads.com"]);

export async function fetchBlueskySignalEvents(
  config: AppConfig,
  fetchedAt: string,
  actors = config.sourcing.blueskyWatchlist
): Promise<SignalEventInput[]> {
  if (!config.sourcing.blueskyEnabled || actors.length === 0) {
    return [];
  }

  const apiBase = config.sourceUrls.blueskyApiBase.replace(/\/+$/, "");
  const events = await Promise.all(
    actors.map(async (actor) => {
      const url =
        `${apiBase}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor.handle)}` +
        `&limit=${config.sourcing.blueskyMaxPostsPerActor}`;
      const response = await fetchJson<BlueskyAuthorFeedResponse>(url, config.httpTimeoutMs);
      return extractBlueskySignalEvents(response, actor, fetchedAt);
    })
  );

  return events.flat();
}

export function extractBlueskySignalEvents(
  response: BlueskyAuthorFeedResponse,
  actor: BlueskyWatchActor,
  fetchedAt: string
): SignalEventInput[] {
  return (response.feed ?? [])
    .map((entry) => toSignalEvent(entry, actor, fetchedAt))
    .filter((event): event is SignalEventInput => Boolean(event));
}

function toSignalEvent(entry: BlueskyFeedItem, actor: BlueskyWatchActor, fetchedAt: string): SignalEventInput | null {
  const post = entry.post;
  const uri = post?.uri;
  const handle = post?.author?.handle ?? actor.handle;
  if (!uri || !handle) {
    return null;
  }

  const text = collapseWhitespace(post.record?.text ?? "");
  const linkedUrls = extractLinkedUrls(entry);
  const linkedUrl = selectPrimaryLinkedUrl(linkedUrls);
  const postUrl = toBlueskyPostUrl(handle, uri);

  return {
    sourceId: "bluesky_watch",
    sourceLayer: "early_warning",
    actorLabel: actor.label,
    actorHandle: handle,
    postUrl,
    linkedUrl,
    title: truncate(text, 180),
    excerpt: truncate(text, 320),
    publishedAt: post.record?.createdAt ?? post.indexedAt ?? fetchedAt,
    fetchedAt,
    metrics: {
      likes: post.likeCount ?? 0,
      reposts: post.repostCount ?? 0,
      replies: post.replyCount ?? 0,
      quotes: post.quoteCount ?? 0,
      bookmarks: post.bookmarkCount ?? 0
    },
    metadata: {
      actorDid: post.author?.did ?? null,
      linkedUrls,
      indexedAt: post.indexedAt ?? null
    }
  };
}

function extractLinkedUrls(entry: BlueskyFeedItem): string[] {
  const urls: Array<string | undefined | null> = [];
  for (const facet of entry.post?.record?.facets ?? []) {
    for (const feature of facet.features ?? []) {
      if (feature.$type === "app.bsky.richtext.facet#link") {
        urls.push(feature.uri);
      }
    }
  }

  if (entry.post?.embed?.external?.uri) {
    urls.push(entry.post.embed.external.uri);
  }

  return uniqueStrings(urls.map((value) => safeCanonicalizeUrl(value)));
}

function selectPrimaryLinkedUrl(urls: string[]): string | null {
  for (const url of urls) {
    const hostname = new URL(url).hostname;
    if (!SOCIAL_HOSTS.has(hostname)) {
      return url;
    }
  }

  return urls[0] ?? null;
}

function toBlueskyPostUrl(handle: string, uri: string): string {
  const parts = uri.split("/");
  const postId = parts[parts.length - 1];
  return `https://bsky.app/profile/${handle}/post/${postId}`;
}

function safeCanonicalizeUrl(input?: string | null): string | null {
  if (!input) {
    return null;
  }

  try {
    return canonicalizeUrl(input);
  } catch {
    return null;
  }
}
