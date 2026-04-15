import type { HousingUnitType } from "./types.js";

export const XHS_RENT_WATCH_QUERIES = [
  "旧金山 转租",
  "旧金山 短租",
  "旧金山 暑租",
  "旧金山 租房",
  "旧金山 studio",
  "旧金山 1b1b",
  "San Francisco sublease",
  "San Francisco studio"
] as const;

export const COMMUTE_FRIENDLY_NEIGHBORHOODS = [
  "mission bay",
  "dogpatch",
  "potrero hill",
  "soma",
  "south beach",
  "mission",
  "hayes valley",
  "lower haight",
  "duboce triangle",
  "castro",
  "noe valley",
  "bernal heights",
  "cole valley",
  "haight-ashbury",
  "nopa",
  "inner richmond",
  "inner sunset",
  "west portal",
  "glen park",
  "nob hill",
  "russian hill",
  "north beach",
  "chinatown",
  "pacific heights",
  "marina",
  "cow hollow",
  "bayview"
] as const;

export const SF_REJECT_LOCATIONS = [
  "oakland",
  "berkeley",
  "daly city",
  "south san francisco",
  "ssf",
  "millbrae",
  "san mateo",
  "palo alto",
  "sunnyvale",
  "mountain view",
  "san jose",
  "fremont",
  "cupertino",
  "redwood city",
  "menlo park"
] as const;

export const WHOLE_UNIT_POSITIVE_PATTERNS = [
  /\bstudio\b/i,
  /\b1\s*b\s*1\s*b\b/i,
  /\b1b\/1b\b/i,
  /\b1bed(?:room)?\b/i,
  /\bentire (?:unit|apartment|place)\b/i,
  /\bwhole (?:unit|apartment|place)\b/i,
  /\bfull apartment\b/i,
  /整租/,
  /独立(?:出入|厨房|卫浴|卫生间|浴室)/,
  /一室一厅/,
  /一房一卫/,
  /单身公寓/,
  /开间/
] as const;

export const FEMALE_ONLY_PATTERNS = [
  /\bfemale only\b/i,
  /\bwomen only\b/i,
  /\bgirls only\b/i,
  /\bladies only\b/i,
  /限女/,
  /仅限女/,
  /女生优先/,
  /仅女生/,
  /女生限定/,
  /限女生/,
  /只限女生/
] as const;

export const ROOMMATE_PATTERNS = [
  /\bprivate room\b/i,
  /\broom available\b/i,
  /\broom for rent\b/i,
  /\broommate\b/i,
  /\bmaster bedroom\b/i,
  /\bbedroom only\b/i,
  /\blooking for roommate\b/i,
  /单间/,
  /次卧/,
  /主卧/,
  /找室友/,
  /室友/,
  /房间出租/
] as const;

export const SHARED_SPACE_PATTERNS = [
  /\bshared kitchen\b/i,
  /\bshared bath(?:room)?\b/i,
  /\bshare(?:d)? bathroom\b/i,
  /\bshare(?:d)? kitchen\b/i,
  /\bshared apartment\b/i,
  /\bshared place\b/i,
  /合租/,
  /共用(?:厨房|卫浴|卫生间|浴室)/,
  /共享(?:厨房|卫浴|卫生间|浴室)/,
  /公用(?:厨房|卫浴|卫生间|浴室)/
] as const;

export const STUDIO_PATTERNS = [/\bstudio\b/i, /单身公寓/, /开间/] as const;

export const ONE_BED_PATTERNS = [
  /\b1\s*b\s*1\s*b\b/i,
  /\b1b\/1b\b/i,
  /\b1\s*bed(?:room)?(?:\s*1\s*bath)?\b/i,
  /\b1bd1ba\b/i,
  /一室一厅/,
  /一房一卫/
] as const;

export const TARGET_AVAILABILITY = {
  strictStart: "2026-05-15",
  strictEnd: "2026-08-15",
  broadStart: "2026-05-01",
  broadEnd: "2026-08-31"
} as const;

export const VISION_PROMPT_VERSION = "xhs_rent_vision_v1";
export const ADJUDICATION_PROMPT_VERSION = "xhs_rent_adjudication_v1";

export const DEFAULT_NOTIFICATION_COOLDOWN_HOURS = 12;

export function formatUnitType(unitType: HousingUnitType): string {
  if (unitType === "studio") {
    return "studio";
  }
  if (unitType === "1b1b") {
    return "1b1b";
  }
  if (unitType === "other") {
    return "other";
  }
  return "unknown";
}
