export type HousingDecision = "match" | "maybe" | "reject";

export type HousingUnitType = "studio" | "1b1b" | "other" | "unknown";

export interface XiaohongshuSearchResult {
  noteId: string;
  noteUrl: string;
  title: string;
  authorName?: string;
  coverImageUrl?: string;
  query: string;
  rawPayload: Record<string, unknown>;
}

export interface XiaohongshuNoteDetail {
  noteId: string;
  noteUrl: string;
  title: string;
  bodyText: string;
  authorName?: string;
  postedAt?: string | null;
  locationText?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  imageUrls: string[];
  pageText: string;
  rawPayload: Record<string, unknown>;
}

export interface HousingVisionSignals {
  ocrText: string;
  dateClues: string[];
  locationClues: string[];
  unitClues: string[];
  wholeUnitClues: string[];
  femaleOnlyClues: string[];
  sharedSpaceClues: string[];
}

export interface HousingRuleEvaluation {
  decision: HousingDecision;
  decisionReasons: string[];
  city?: string | null;
  neighborhood?: string | null;
  locationSummary?: string | null;
  unitType: HousingUnitType;
  wholeUnit: boolean | null;
  femaleOnly: boolean | null;
  sharedSpace: boolean | null;
  roommateOnly: boolean | null;
  commuteFriendly: boolean | null;
  availabilitySummary?: string | null;
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
}

export interface HousingCandidateForAdjudication {
  noteId: string;
  noteUrl: string;
  title: string;
  bodyText: string;
  locationText?: string | null;
  postedAt?: string | null;
  authorName?: string;
  imageUrls: string[];
  screenshotDataUrl?: string | null;
  pageText: string;
  searchQueries: string[];
  ruleEvaluation: HousingRuleEvaluation;
  visionSignals?: HousingVisionSignals | null;
}

export interface HousingAdjudicationResult {
  noteId: string;
  decision: HousingDecision;
  confidence: number;
  city?: string | null;
  neighborhood?: string | null;
  locationSummary?: string | null;
  availabilitySummary?: string | null;
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
  unitType: HousingUnitType;
  wholeUnit: boolean | null;
  femaleOnly: boolean | null;
  sharedSpace: boolean | null;
  roommateOnly: boolean | null;
  commuteFriendly: boolean | null;
  decisionReasons: string[];
  uncertaintyNotes: string[];
}

export interface HousingCandidateRecord {
  id: number;
  noteId: string;
  noteUrl: string;
  title: string;
  authorName?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  locationSummary?: string | null;
  locationText?: string | null;
  postedAt?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastEvaluatedAt?: string | null;
  searchQueries: string[];
  bodyText: string;
  pageText: string;
  ocrText?: string | null;
  imageUrls: string[];
  screenshotCaptured: boolean;
  hardFilterDecision: HousingDecision;
  hardFilterReasons: string[];
  llmPromptVersion?: string | null;
  llmModelName?: string | null;
  llmInputHash?: string | null;
  llmOutputJson?: Record<string, unknown> | null;
  decision: HousingDecision;
  decisionReasons: string[];
  confidence?: number | null;
  unitType: HousingUnitType;
  wholeUnit: boolean | null;
  femaleOnly: boolean | null;
  sharedSpace: boolean | null;
  roommateOnly: boolean | null;
  availabilitySummary?: string | null;
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
  commuteFriendly: boolean | null;
  rawPayload: Record<string, unknown>;
}

export interface HousingNotificationRecord {
  id: number;
  candidateId?: number | null;
  notificationType: "candidate" | "maintenance";
  deliveryKey: string;
  destinationUserId: string;
  status: "pending" | "sent" | "error" | "skipped";
  messageText: string;
  errorText?: string | null;
  createdAt: string;
  sentAt?: string | null;
}
