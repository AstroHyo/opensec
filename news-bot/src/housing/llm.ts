import { z } from "zod";
import type { AppConfig } from "../config.js";
import { generateStructuredJson, generateStructuredJsonWithResponsesInput } from "../llm/openaiClient.js";
import { ADJUDICATION_PROMPT_VERSION, VISION_PROMPT_VERSION } from "./constants.js";
import type {
  HousingAdjudicationResult,
  HousingCandidateForAdjudication,
  HousingDecision,
  HousingUnitType,
  HousingVisionSignals
} from "./types.js";

const nullableBoolean = z.union([z.boolean(), z.null()]);
const nullableString = z.union([z.string(), z.null()]);

const visionSignalSchema = z.object({
  ocr_text: z.string().max(3000),
  date_clues: z.array(z.string().min(1).max(120)).max(8),
  location_clues: z.array(z.string().min(1).max(120)).max(8),
  unit_clues: z.array(z.string().min(1).max(120)).max(8),
  whole_unit_clues: z.array(z.string().min(1).max(120)).max(8),
  female_only_clues: z.array(z.string().min(1).max(120)).max(8),
  shared_space_clues: z.array(z.string().min(1).max(120)).max(8)
});

const housingAdjudicationItemSchema = z.object({
  note_id: z.string().min(1),
  decision: z.enum(["match", "maybe", "reject"]),
  confidence: z.number().min(0).max(1),
  city: nullableString,
  neighborhood: nullableString,
  location_summary: nullableString,
  availability_summary: nullableString,
  availability_start: nullableString,
  availability_end: nullableString,
  unit_type: z.enum(["studio", "1b1b", "other", "unknown"]),
  whole_unit: nullableBoolean,
  female_only: nullableBoolean,
  shared_space: nullableBoolean,
  roommate_only: nullableBoolean,
  commute_friendly: nullableBoolean,
  decision_reasons: z.array(z.string().min(1).max(160)).max(5),
  uncertainty_notes: z.array(z.string().min(1).max(160)).max(4)
});

const housingAdjudicationBatchSchema = z.object({
  items: z.array(housingAdjudicationItemSchema)
});

const visionSignalJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "ocr_text",
    "date_clues",
    "location_clues",
    "unit_clues",
    "whole_unit_clues",
    "female_only_clues",
    "shared_space_clues"
  ],
  properties: {
    ocr_text: { type: "string" },
    date_clues: { type: "array", items: { type: "string" }, maxItems: 8 },
    location_clues: { type: "array", items: { type: "string" }, maxItems: 8 },
    unit_clues: { type: "array", items: { type: "string" }, maxItems: 8 },
    whole_unit_clues: { type: "array", items: { type: "string" }, maxItems: 8 },
    female_only_clues: { type: "array", items: { type: "string" }, maxItems: 8 },
    shared_space_clues: { type: "array", items: { type: "string" }, maxItems: 8 }
  }
} as const;

const housingAdjudicationJsonSchema = {
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
          "note_id",
          "decision",
          "confidence",
          "city",
          "neighborhood",
          "location_summary",
          "availability_summary",
          "availability_start",
          "availability_end",
          "unit_type",
          "whole_unit",
          "female_only",
          "shared_space",
          "roommate_only",
          "commute_friendly",
          "decision_reasons",
          "uncertainty_notes"
        ],
        properties: {
          note_id: { type: "string" },
          decision: { type: "string", enum: ["match", "maybe", "reject"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          city: { type: ["string", "null"] },
          neighborhood: { type: ["string", "null"] },
          location_summary: { type: ["string", "null"] },
          availability_summary: { type: ["string", "null"] },
          availability_start: { type: ["string", "null"] },
          availability_end: { type: ["string", "null"] },
          unit_type: { type: "string", enum: ["studio", "1b1b", "other", "unknown"] },
          whole_unit: { type: ["boolean", "null"] },
          female_only: { type: ["boolean", "null"] },
          shared_space: { type: ["boolean", "null"] },
          roommate_only: { type: ["boolean", "null"] },
          commute_friendly: { type: ["boolean", "null"] },
          decision_reasons: { type: "array", items: { type: "string" }, maxItems: 5 },
          uncertainty_notes: { type: "array", items: { type: "string" }, maxItems: 4 }
        }
      }
    }
  }
} as const;

export async function maybeExtractVisionSignals(input: {
  apiKey: string;
  config: AppConfig;
  candidate: HousingCandidateForAdjudication;
}): Promise<{ data: HousingVisionSignals; usage?: Record<string, unknown> | null } | null> {
  if (!input.config.housingWatcher.visionEnabled || !input.candidate.screenshotDataUrl) {
    return null;
  }

  const modelName = resolveHousingOpenAiModel(input.config);
  const response = await generateStructuredJsonWithResponsesInput({
    apiKey: input.apiKey,
    model: modelName,
    schemaName: "xhs_rent_vision_signals",
    schema: visionSignalJsonSchema,
    validator: visionSignalSchema,
    systemPrompt: [
      "You extract factual housing signals from a Xiaohongshu rental post screenshot.",
      "Use only visible text or layout clues from the supplied screenshot and text bundle.",
      "Do not guess dates, location, or housing type if they are not visible.",
      "Return JSON only."
    ].join(" "),
    inputItems: [
      {
        type: "text",
        text: [
          `Note title: ${input.candidate.title}`,
          `Note body: ${input.candidate.bodyText}`,
          `Page text: ${input.candidate.pageText}`,
          `Location text: ${input.candidate.locationText ?? "unknown"}`
        ].join("\n")
      },
      {
        type: "image",
        imageUrl: input.candidate.screenshotDataUrl
      }
    ],
    timeoutMs: input.config.llm.timeoutMs
  });

  return {
    data: {
      ocrText: response.data.ocr_text,
      dateClues: response.data.date_clues,
      locationClues: response.data.location_clues,
      unitClues: response.data.unit_clues,
      wholeUnitClues: response.data.whole_unit_clues,
      femaleOnlyClues: response.data.female_only_clues,
      sharedSpaceClues: response.data.shared_space_clues
    },
    usage: response.usage ?? null
  };
}

export async function adjudicateHousingCandidates(input: {
  apiKey: string;
  config: AppConfig;
  candidates: HousingCandidateForAdjudication[];
}): Promise<{ results: HousingAdjudicationResult[]; usage?: Record<string, unknown> | null }> {
  const prompts = buildAdjudicationPrompts(input.candidates);
  const modelName = resolveHousingOpenAiModel(input.config);
  const response = await generateStructuredJson({
    apiKey: input.apiKey,
    model: modelName,
    schemaName: "xhs_rent_adjudication_batch",
    schema: housingAdjudicationJsonSchema,
    validator: housingAdjudicationBatchSchema,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    timeoutMs: input.config.llm.timeoutMs
  });

  return {
    results: response.data.items.map((item) => mapAdjudicationItem(item)),
    usage: response.usage ?? null
  };
}

export function mapAdjudicationItem(item: z.infer<typeof housingAdjudicationItemSchema>): HousingAdjudicationResult {
  return {
    noteId: item.note_id,
    decision: item.decision as HousingDecision,
    confidence: item.confidence,
    city: item.city,
    neighborhood: item.neighborhood,
    locationSummary: item.location_summary,
    availabilitySummary: item.availability_summary,
    availabilityStart: item.availability_start,
    availabilityEnd: item.availability_end,
    unitType: item.unit_type as HousingUnitType,
    wholeUnit: item.whole_unit,
    femaleOnly: item.female_only,
    sharedSpace: item.shared_space,
    roommateOnly: item.roommate_only,
    commuteFriendly: item.commute_friendly,
    decisionReasons: item.decision_reasons,
    uncertaintyNotes: item.uncertainty_notes
  };
}

export function resolveHousingOpenAiModel(config: AppConfig): string {
  for (const candidate of [config.llm.modelTierSmall, config.llm.modelTierMedium, config.llm.modelTierDeep]) {
    const parsed = parseProviderQualifiedModel(candidate);
    if (parsed.provider === "openai") {
      return parsed.model;
    }
  }

  return "gpt-4.1-mini";
}

function buildAdjudicationPrompts(candidates: HousingCandidateForAdjudication[]): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    "You are classifying Xiaohongshu housing posts for a single renter.",
    "The user wants only San Francisco whole-unit studio or 1b1b summer rentals.",
    "Reject any female-only listing, roommate search, room-only listing, or shared kitchen/bathroom listing.",
    "Prefer conservative decisions: if key evidence is missing, return maybe instead of match.",
    "Use only the supplied text, OCR, and rule-based signals.",
    "Return JSON only."
  ].join(" ");

  const payload = candidates.map((candidate) => ({
    note_id: candidate.noteId,
    note_url: candidate.noteUrl,
    title: candidate.title,
    body_text: candidate.bodyText,
    page_text: candidate.pageText,
    location_text: candidate.locationText ?? null,
    posted_at: candidate.postedAt ?? null,
    search_queries: candidate.searchQueries,
    rule_decision: candidate.ruleEvaluation.decision,
    rule_reasons: candidate.ruleEvaluation.decisionReasons,
    rule_city: candidate.ruleEvaluation.city ?? null,
    rule_neighborhood: candidate.ruleEvaluation.neighborhood ?? null,
    rule_location_summary: candidate.ruleEvaluation.locationSummary ?? null,
    rule_unit_type: candidate.ruleEvaluation.unitType,
    rule_whole_unit: candidate.ruleEvaluation.wholeUnit,
    rule_female_only: candidate.ruleEvaluation.femaleOnly,
    rule_shared_space: candidate.ruleEvaluation.sharedSpace,
    rule_roommate_only: candidate.ruleEvaluation.roommateOnly,
    rule_commute_friendly: candidate.ruleEvaluation.commuteFriendly,
    rule_availability_summary: candidate.ruleEvaluation.availabilitySummary ?? null,
    rule_availability_start: candidate.ruleEvaluation.availabilityStart ?? null,
    rule_availability_end: candidate.ruleEvaluation.availabilityEnd ?? null,
    ocr_text: candidate.visionSignals?.ocrText ?? "",
    vision_date_clues: candidate.visionSignals?.dateClues ?? [],
    vision_location_clues: candidate.visionSignals?.locationClues ?? [],
    vision_unit_clues: candidate.visionSignals?.unitClues ?? [],
    vision_whole_unit_clues: candidate.visionSignals?.wholeUnitClues ?? [],
    vision_female_only_clues: candidate.visionSignals?.femaleOnlyClues ?? [],
    vision_shared_space_clues: candidate.visionSignals?.sharedSpaceClues ?? []
  }));

  const userPrompt = [
    "Classify every candidate.",
    "Use `match` only when you are reasonably sure it is a San Francisco whole-unit studio/1b1b summer rental that fits the user's needs.",
    "Use `reject` when the evidence shows female-only, room-only, shared-space, non-SF, or clearly wrong unit/date.",
    "Use `maybe` for any remaining ambiguity.",
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function parseProviderQualifiedModel(value: string): { provider: "openai" | "xai" | "unknown"; model: string } {
  const trimmed = value.trim();
  if (!trimmed.includes(":")) {
    return {
      provider: "openai",
      model: trimmed
    };
  }

  const [provider, ...rest] = trimmed.split(":");
  const model = rest.join(":").trim();
  if ((provider === "openai" || provider === "xai") && model.length > 0) {
    return {
      provider,
      model
    };
  }

  return {
    provider: "unknown",
    model: trimmed
  };
}

export { ADJUDICATION_PROMPT_VERSION, VISION_PROMPT_VERSION };
