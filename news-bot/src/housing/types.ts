export type HousingDecision = "allow" | "reject" | "needs_review" | "unknown";

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
  unitType: "unknown" | "studio" | "1br" | "2br_plus" | "shared";
  wholeUnit?: boolean | null;
  femaleOnly?: boolean | null;
  sharedSpace?: boolean | null;
  roommateOnly?: boolean | null;
  availabilitySummary?: string | null;
  availabilityStart?: string | null;
  availabilityEnd?: string | null;
  commuteFriendly?: boolean | null;
  rawPayload: Record<string, unknown>;
}

export interface HousingNotificationRecord {
  id: number;
  candidateId?: number | null;
  notificationType: "digest" | "alert" | "manual";
  deliveryKey: string;
  destinationUserId: string;
  status: "queued" | "sent" | "error";
  messageText: string;
  errorText?: string | null;
  createdAt: string;
  sentAt?: string | null;
}
