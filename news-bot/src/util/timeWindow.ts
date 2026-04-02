import { DateTime } from "luxon";
import type { DigestMode, DigestWindow, SavedDigestRecord } from "../types.js";

interface ResolveWindowParams {
  mode: DigestMode;
  timezone: string;
  now: DateTime;
  lastAmDigest?: SavedDigestRecord | null;
  lastPmDigest?: SavedDigestRecord | null;
}

export function resolveDigestWindow(params: ResolveWindowParams): DigestWindow {
  const localNow = params.now.setZone(params.timezone);
  let start = localNow.minus({ hours: 12 });

  if (params.mode === "am") {
    start = params.lastPmDigest
      ? DateTime.fromISO(params.lastPmDigest.windowEnd, { zone: "utc" }).setZone(params.timezone)
      : localNow.minus({ hours: 18 });
  }

  if (params.mode === "pm") {
    start = params.lastAmDigest
      ? DateTime.fromISO(params.lastAmDigest.windowEnd, { zone: "utc" }).setZone(params.timezone)
      : localNow.startOf("day");
  }

  if (params.mode === "manual") {
    start = localNow.minus({ hours: 24 });
  }

  return {
    mode: params.mode,
    startUtc: start.toUTC().toISO() ?? new Date().toISOString(),
    endUtc: localNow.toUTC().toISO() ?? new Date().toISOString(),
    dateLabel: localNow.toFormat("yyyy-LL-dd")
  };
}
