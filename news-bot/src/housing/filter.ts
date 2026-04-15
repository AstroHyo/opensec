import { DateTime } from "luxon";
import {
  COMMUTE_FRIENDLY_NEIGHBORHOODS,
  FEMALE_ONLY_PATTERNS,
  ONE_BED_PATTERNS,
  ROOMMATE_PATTERNS,
  SF_REJECT_LOCATIONS,
  SHARED_SPACE_PATTERNS,
  STUDIO_PATTERNS,
  TARGET_AVAILABILITY,
  WHOLE_UNIT_POSITIVE_PATTERNS
} from "./constants.js";
import type { HousingRuleEvaluation, HousingUnitType } from "./types.js";
import { collapseWhitespace } from "../util/text.js";

const SAN_FRANCISCO_PATTERNS = [/\bsan francisco\b/i, /(^|[^\p{L}])sf([^\p{L}]|$)/iu, /旧金山/] as const;
const SUMMER_PATTERNS = [/\bsummer\b/i, /暑租/, /暑期/, /summer sublease/i] as const;
const NON_TARGET_UNIT_PATTERNS = [
  /\b[2-9]\s*b\s*[1-9]\s*b\b/i,
  /\b[2-9]\s*bed(?:room)?\b/i,
  /两室/,
  /三室/,
  /两房/,
  /三房/
] as const;

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8
};

export function evaluateHousingRules(input: {
  title: string;
  bodyText: string;
  pageText?: string;
  locationText?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  ocrText?: string | null;
}): HousingRuleEvaluation {
  const combinedText = collapseWhitespace(
    [input.title, input.bodyText, input.pageText ?? "", input.locationText ?? "", input.city ?? "", input.neighborhood ?? "", input.ocrText ?? ""]
      .filter(Boolean)
      .join("\n")
  );
  const lower = combinedText.toLowerCase();

  const femaleOnly = matchesAny(FEMALE_ONLY_PATTERNS, combinedText) ? true : null;
  const roommateOnly = matchesAny(ROOMMATE_PATTERNS, combinedText) ? true : null;
  const sharedSpace = matchesAny(SHARED_SPACE_PATTERNS, combinedText) ? true : null;
  const unitType = detectUnitType(combinedText);
  const wholeUnit = determineWholeUnit(unitType, combinedText, roommateOnly, sharedSpace);
  const location = detectLocation({
    combinedText,
    providedCity: input.city ?? null,
    providedNeighborhood: input.neighborhood ?? null,
    locationText: input.locationText ?? null
  });
  const availability = detectAvailability(lower);

  const reasons: string[] = [];

  if (femaleOnly) {
    reasons.push("여성 전용 또는 여성 우선으로 보입니다.");
  }
  if (roommateOnly) {
    reasons.push("룸메이트/개별 room 모집으로 보입니다.");
  }
  if (sharedSpace) {
    reasons.push("공용 kitchen 또는 bathroom 조건으로 보입니다.");
  }
  if (location.explicitlyOutsideSf) {
    reasons.push("San Francisco 외 지역으로 보입니다.");
  }
  if (unitType === "other") {
    reasons.push("studio 또는 1b1b가 아닌 유닛으로 보입니다.");
  }
  if (availability.clearlyOutsideWindow) {
    reasons.push("5월~8월 여름 임대 기간과 맞지 않아 보입니다.");
  }

  if (reasons.length > 0) {
    return {
      decision: "reject",
      decisionReasons: reasons,
      city: location.city,
      neighborhood: location.neighborhood,
      locationSummary: location.locationSummary,
      unitType,
      wholeUnit,
      femaleOnly,
      sharedSpace,
      roommateOnly,
      commuteFriendly: location.commuteFriendly,
      availabilitySummary: availability.summary,
      availabilityStart: availability.start,
      availabilityEnd: availability.end
    };
  }

  const maybeReasons: string[] = [];
  if (unitType === "unknown") {
    maybeReasons.push("studio/1b1b 여부가 본문만으로 명확하지 않습니다.");
  }
  if (wholeUnit !== true) {
    maybeReasons.push("전체 유닛인지 확정하기 어렵습니다.");
  }
  if (!location.city && !location.neighborhood) {
    maybeReasons.push("위치가 San Francisco 내 어디인지 불명확합니다.");
  } else if (location.commuteFriendly !== true) {
    maybeReasons.push("3rd St 출근권인지 위치 정보가 충분하지 않습니다.");
  }
  if (!availability.summary) {
    maybeReasons.push("가능 기간이 본문만으로 명확하지 않습니다.");
  }

  return {
    decision: maybeReasons.length === 0 ? "match" : "maybe",
    decisionReasons:
      maybeReasons.length === 0
        ? [
            "본문 기준으로 studio 또는 1b1b 전체 유닛으로 보입니다.",
            "San Francisco 내 출근권 위치로 보입니다.",
            "여름 임대 가능 기간으로 보입니다."
          ]
        : maybeReasons,
    city: location.city,
    neighborhood: location.neighborhood,
    locationSummary: location.locationSummary,
    unitType,
    wholeUnit,
    femaleOnly,
    sharedSpace,
    roommateOnly,
    commuteFriendly: location.commuteFriendly,
    availabilitySummary: availability.summary,
    availabilityStart: availability.start,
    availabilityEnd: availability.end
  };
}

function matchesAny(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function detectUnitType(text: string): HousingUnitType {
  if (matchesAny(STUDIO_PATTERNS, text)) {
    return "studio";
  }
  if (matchesAny(ONE_BED_PATTERNS, text)) {
    return "1b1b";
  }
  if (matchesAny(NON_TARGET_UNIT_PATTERNS, text)) {
    return "other";
  }
  return "unknown";
}

function determineWholeUnit(
  unitType: HousingUnitType,
  text: string,
  roommateOnly: boolean | null,
  sharedSpace: boolean | null
): boolean | null {
  if (roommateOnly || sharedSpace) {
    return false;
  }
  if (unitType === "studio") {
    return true;
  }
  if (matchesAny(WHOLE_UNIT_POSITIVE_PATTERNS, text)) {
    return true;
  }
  if (unitType === "1b1b") {
    return null;
  }
  return null;
}

function detectLocation(input: {
  combinedText: string;
  providedCity?: string | null;
  providedNeighborhood?: string | null;
  locationText?: string | null;
}): {
  city?: string | null;
  neighborhood?: string | null;
  locationSummary?: string | null;
  commuteFriendly: boolean | null;
  explicitlyOutsideSf: boolean;
} {
  const lower = input.combinedText.toLowerCase();
  const providedNeighborhood = normalizeNeighborhood(input.providedNeighborhood);
  const matchedNeighborhood =
    providedNeighborhood ??
    COMMUTE_FRIENDLY_NEIGHBORHOODS.find((neighborhood) => lower.includes(neighborhood)) ??
    null;

  const explicitlyOutsideSf = SF_REJECT_LOCATIONS.some((token) => lower.includes(token));
  const sanFranciscoMentioned = matchesAny(SAN_FRANCISCO_PATTERNS, input.combinedText) || Boolean(matchedNeighborhood);
  const city = explicitlyOutsideSf ? "outside_sf" : input.providedCity ?? (sanFranciscoMentioned ? "San Francisco" : null);
  const locationSummary = collapseWhitespace([matchedNeighborhood ?? "", input.locationText ?? ""].filter(Boolean).join(" / ")) || null;

  return {
    city,
    neighborhood: matchedNeighborhood,
    locationSummary,
    commuteFriendly: matchedNeighborhood ? true : sanFranciscoMentioned ? null : null,
    explicitlyOutsideSf
  };
}

function normalizeNeighborhood(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase();
  return COMMUTE_FRIENDLY_NEIGHBORHOODS.find((neighborhood) => lower.includes(neighborhood)) ?? null;
}

function detectAvailability(text: string): {
  summary?: string | null;
  start?: string | null;
  end?: string | null;
  clearlyOutsideWindow: boolean;
} {
  const months = collectMentionedMonths(text);
  const hasSummerToken = matchesAny(SUMMER_PATTERNS, text);
  const hasMidMay = /mid[\s-]?may|5月中旬|05[\/.-]?15|5[\/.-]15/.test(text);
  const hasMidAugust = /mid[\s-]?aug(?:ust)?|8月中旬|08[\/.-]?15|8[\/.-]15/.test(text);

  let start: string | null = null;
  let end: string | null = null;
  let summary: string | null = null;

  if (hasMidMay && hasMidAugust) {
    start = TARGET_AVAILABILITY.strictStart;
    end = TARGET_AVAILABILITY.strictEnd;
    summary = "mid-May to mid-August";
  } else if (months.length > 0) {
    const sortedMonths = [...new Set(months)].sort((left, right) => left - right);
    const firstMonth = sortedMonths[0];
    const lastMonth = sortedMonths[sortedMonths.length - 1];
    start = DateTime.utc(2026, firstMonth, 1).toISODate();
    end = DateTime.utc(2026, lastMonth, 1).endOf("month").toISODate();
    summary = `${firstMonth}월-${lastMonth}월 가능`;
  } else if (hasSummerToken) {
    start = TARGET_AVAILABILITY.broadStart;
    end = TARGET_AVAILABILITY.broadEnd;
    summary = "summer rental";
  }

  if (start && end) {
    const outsideWindow = end < TARGET_AVAILABILITY.broadStart || start > TARGET_AVAILABILITY.broadEnd;
    return { summary, start, end, clearlyOutsideWindow: outsideWindow };
  }

  return {
    summary,
    start,
    end,
    clearlyOutsideWindow: false
  };
}

function collectMentionedMonths(text: string): number[] {
  const monthMatches = [...text.matchAll(/(\d{1,2})\s*月/g)].map((match) => Number.parseInt(match[1], 10));
  const englishMonthMatches = Object.entries(MONTH_NAME_TO_NUMBER)
    .filter(([label]) => new RegExp(`\\b${label}\\b`, "i").test(text))
    .map(([, month]) => month);

  return [...monthMatches, ...englishMonthMatches].filter((month) => month >= 1 && month <= 12);
}
