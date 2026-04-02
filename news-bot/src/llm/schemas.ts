import { z } from "zod";

export const ITEM_ENRICHMENT_PROMPT_VERSION = "item_enrichment_v1";
export const THEME_SYNTHESIS_PROMPT_VERSION = "theme_synthesis_v1";

export const itemEnrichmentSchema = z.object({
  item_id: z.number().int().nonnegative(),
  summary_ko: z.string().min(1).max(240),
  why_important_ko: z.string().min(1).max(220),
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

export type ItemEnrichmentBatch = z.infer<typeof itemEnrichmentBatchSchema>;
export type DigestThemePayload = z.infer<typeof digestThemeSchema>;

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
          "summary_ko",
          "why_important_ko",
          "confidence",
          "uncertainty_notes",
          "theme_tags",
          "officialness_note"
        ],
        properties: {
          item_id: { type: "integer" },
          summary_ko: { type: "string" },
          why_important_ko: { type: "string" },
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
