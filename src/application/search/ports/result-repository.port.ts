import type { ContentType } from "../../../domain/analyze/content-type";
import type { Sentiment } from "../../../domain/analyze/sentiment";
import type { VerificationStatus } from "../../../domain/analyze/verification-status";
import type { ExclusionCode } from "../../../domain/filter/exclusion-code";
import type { FilterResult } from "../../../domain/filter/filter-result";

export type ResultSource = "tavily" | "web_search_backstop";

export type ResultInsert = {
	url: string;
	normalizedUrl: string;
	title: string;
	snippet: string;
	matchScore: number; // provisional only
	publishedDate: string | null;
	source: ResultSource;
};

// Re-export so Filter consumers can import the read-model from the port if convenient.
export type { FilterResult };

/**
 * The read-model analyze needs from the `included` pool. It is a STRUCTURAL SUBSET of Filter's
 * FilterResult, so `findIncluded(jobId)` is reused as-is — the shell reads the pool and uses the
 * id / url / title / snippet fields (match_score / published_date are already persisted).
 */
export type AnalyzeResult = {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly snippet: string;
};

/**
 * Summarise's read-model: each surviving (`included`) Result's snippet + its
 * Enhancement. No id/url/title — distinct from Filter's FilterResult.
 */
export type SummariseResultRow = {
	readonly snippet: string;
	readonly takeaway: string | null; //                            Enhance's per-Result takeaway (nullable)
	readonly sentiment: "positive" | "neutral" | "negative" | null; // Enhance's per-Result Sentiment (nullable)
};

/** The single durable write of the fused full-text pass (rung 3 + status + type + enhance). */
export type FullTextOutcome = {
	readonly matchScore: number; //                      final rung — overwrites interim
	readonly verificationStatus: VerificationStatus; //  verified | uncertain (only the full-text pass writes this)
	readonly contentType: ContentType | null; //         re-Classify; null if the field was unusable (Warning)
	readonly sentiment: Sentiment | null; //             Enhance; null if Enhance failed (Warning)
	readonly takeaway: string | null; //                 Enhance; null if Enhance failed (Warning)
};

/** Writes born-`included` Results; insert-time URL-dedup is the DB unique constraint, not app code. */
export interface ResultRepository {
	// Skips rows that violate (job_id, normalized_url); returns the number ACTUALLY inserted (post-dedup).
	insertIncluded(
		jobId: string,
		results: readonly ResultInsert[],
	): Promise<number>;

	// Filter additions:
	/** The Collapse pool: rows whose status = 'included' (an Excluded copy is never returned). */
	findIncluded(jobId: string): Promise<FilterResult[]>;
	/** The only status transition Filter performs: included → excluded. Idempotent (only WHERE status='included'). */
	recordExclusion(
		resultId: string,
		code: ExclusionCode,
		detail: string | null,
	): Promise<void>;

	// analyze additions — each writes ONLY into reserved/owned nullable columns:
	/** ratchet rung 2 (snippet-Verify) → already-reserved match_score. */
	setInterimMatchScore(resultId: string, score: number): Promise<void>;
	/** snippet-Classify → already-reserved content_type. */
	setProvisionalContentType(resultId: string, type: ContentType): Promise<void>;
	/** the fused-call write → already-reserved columns. */
	applyFullTextOutcome(
		resultId: string,
		outcome: FullTextOutcome,
	): Promise<void>;
	/** on Extract success → this stage's extracted_content column (display-only, PRD 07). */
	setExtractedContent(resultId: string, content: string): Promise<void>;

	// Summarise addition (read-only): only rows whose status = 'included' at the moment Summarise runs.
	findIncludedForSummary(jobId: string): Promise<SummariseResultRow[]>;
}

export const RESULT_REPOSITORY = Symbol("ResultRepository");
