import { z } from "zod";

export const ITEM_ENRICHMENT_PROMPT_VERSION = "item_enrichment_v3";
export const THEME_SYNTHESIS_PROMPT_VERSION = "theme_synthesis_v3";
export const ASK_FOLLOWUP_PROMPT_VERSION = "followup_answer_v2";
export const RESEARCH_FOLLOWUP_PROMPT_VERSION = "followup_research_v2";

export const itemEnrichmentSchema = z.object({
  item_id: z.number().int().nonnegative(),
  what_changed_ko: z.string().min(1).max(520),
  engineer_relevance_ko: z.string().min(1).max(300),
  ai_ecosystem_ko: z.string().min(1).max(260),
  openai_angle_ko: z.string().max(220).nullable(),
  repo_use_case_ko: z.string().max(240).nullable(),
  trend_signal_ko: z.string().min(1).max(220),
  cause_effect_ko: z.string().min(1).max(220),
  watchpoints_ko: z.array(z.string().min(1).max(140)).max(3),
  evidence_spans: z.array(z.string().min(1).max(220)).max(4),
  novelty_score: z.number().min(0).max(1),
  insight_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  uncertainty_notes: z.array(z.string().min(1).max(140)).max(3),
  theme_tags: z.array(z.string().min(1).max(32)).max(6),
  officialness_note: z
    .enum(["official_openai", "official_vendor", "community_discussion", "repo_signal", "mixed_signal", "unknown"])
    .default("unknown")
});

export const itemEnrichmentBatchSchema = z.object({
  items: z.array(itemEnrichmentSchema)
});

export const digestThemeSchema = z.object({
  themes_ko: z.array(z.string().min(1).max(180)).max(4)
});

export const askFollowupSchema = z.object({
  answer_ko: z.string().min(1).max(700),
  bullets_ko: z.array(z.string().min(1).max(160)).max(4),
  used_item_numbers: z.array(z.number().int().positive()).max(5),
  uncertainty_notes: z.array(z.string().min(1).max(140)).max(3)
});

export const researchFollowupSourceSchema = z.object({
  title: z.string().min(1).max(160),
  url: z.string().url(),
  publisher: z.string().min(1).max(80),
  why_used: z.string().min(1).max(120),
  source_type: z.enum(["official", "primary", "reporting", "community", "unknown"])
});

export const researchFollowupSchema = z.object({
  answer_ko: z.string().min(1).max(900),
  bullets_ko: z.array(z.string().min(1).max(280)).max(5),
  implications_ko: z.array(z.string().min(1).max(240)).max(3),
  used_item_numbers: z.array(z.number().int().positive()).max(5),
  uncertainty_notes: z.array(z.string().min(1).max(140)).max(3),
  sources: z.array(researchFollowupSourceSchema).max(6)
});

export type ItemEnrichmentBatch = z.infer<typeof itemEnrichmentBatchSchema>;
export type DigestThemePayload = z.infer<typeof digestThemeSchema>;
export type AskFollowupPayload = z.infer<typeof askFollowupSchema>;
export type ResearchFollowupPayload = z.infer<typeof researchFollowupSchema>;

export const itemEnrichmentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "item_id",
          "what_changed_ko",
          "engineer_relevance_ko",
          "ai_ecosystem_ko",
          "openai_angle_ko",
          "repo_use_case_ko",
          "trend_signal_ko",
          "cause_effect_ko",
          "watchpoints_ko",
          "evidence_spans",
          "novelty_score",
          "insight_score",
          "confidence",
          "uncertainty_notes",
          "theme_tags",
          "officialness_note"
        ],
        properties: {
          item_id: { type: "integer" },
          what_changed_ko: { type: "string", maxLength: 520 },
          engineer_relevance_ko: { type: "string", maxLength: 300 },
          ai_ecosystem_ko: { type: "string", maxLength: 260 },
          openai_angle_ko: { type: ["string", "null"], maxLength: 220 },
          repo_use_case_ko: { type: ["string", "null"], maxLength: 240 },
          trend_signal_ko: { type: "string", maxLength: 220 },
          cause_effect_ko: { type: "string", maxLength: 220 },
          watchpoints_ko: {
            type: "array",
            items: { type: "string" },
            maxItems: 3
          },
          evidence_spans: {
            type: "array",
            items: { type: "string", maxLength: 220 },
            maxItems: 4
          },
          novelty_score: { type: "number", minimum: 0, maximum: 1 },
          insight_score: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          uncertainty_notes: {
            type: "array",
            items: { type: "string" },
            maxItems: 3
          },
          theme_tags: {
            type: "array",
            items: { type: "string" },
            maxItems: 6
          },
          officialness_note: {
            type: "string",
            enum: ["official_openai", "official_vendor", "community_discussion", "repo_signal", "mixed_signal", "unknown"]
          }
        }
      }
    }
  }
} as const;

export const digestThemeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["themes_ko"],
  properties: {
    themes_ko: {
      type: "array",
      items: { type: "string" },
      maxItems: 4
    }
  }
} as const;

export const askFollowupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer_ko", "bullets_ko", "used_item_numbers", "uncertainty_notes"],
  properties: {
    answer_ko: { type: "string" },
    bullets_ko: {
      type: "array",
      items: { type: "string" },
      maxItems: 4
    },
    used_item_numbers: {
      type: "array",
      items: { type: "integer", minimum: 1 },
      maxItems: 5
    },
    uncertainty_notes: {
      type: "array",
      items: { type: "string" },
      maxItems: 3
    }
  }
} as const;

export const researchFollowupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer_ko", "bullets_ko", "implications_ko", "used_item_numbers", "uncertainty_notes", "sources"],
  properties: {
    answer_ko: { type: "string" },
    bullets_ko: {
      type: "array",
      items: { type: "string" },
      maxItems: 5
    },
    implications_ko: {
      type: "array",
      items: { type: "string" },
      maxItems: 3
    },
    used_item_numbers: {
      type: "array",
      items: { type: "integer", minimum: 1 },
      maxItems: 5
    },
    uncertainty_notes: {
      type: "array",
      items: { type: "string" },
      maxItems: 3
    },
    sources: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "publisher", "why_used", "source_type"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publisher: { type: "string" },
          why_used: { type: "string" },
          source_type: {
            type: "string",
            enum: ["official", "primary", "reporting", "community", "unknown"]
          }
        }
      }
    }
  }
} as const;
