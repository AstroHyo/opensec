import crypto from "node:crypto";
import { collapseWhitespace } from "./text.js";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "source",
  "si",
  "trk"
]);

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key)) {
      url.searchParams.delete(key);
    }
  }

  if (url.hostname === "www.github.com") {
    url.hostname = "github.com";
  }

  if (url.hostname.endsWith("github.com")) {
    const parts = url.pathname.split("/").filter(Boolean).slice(0, 2);
    if (parts.length >= 2) {
      url.pathname = `/${parts[0]}/${parts[1]}`;
      url.search = "";
    }
  }

  if (url.hostname === "news.hada.io") {
    const id = url.searchParams.get("id");
    url.pathname = "/topic";
    url.search = id ? `?id=${id}` : "";
  }

  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function normalizeTitle(title: string): string {
  return collapseWhitespace(
    title
      .toLowerCase()
      .replace(/^(ask|show)\s+gn:\s*/i, "")
      .replace(/^news:\s*/i, "")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
  );
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
