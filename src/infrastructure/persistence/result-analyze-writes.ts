import { eq } from "drizzle-orm";
import type { FullTextOutcome } from "../../application/search/ports/result-repository.port";
import type { ContentType } from "../../domain/analyze/content-type";
import type { Database } from "./database";
import { results } from "./schema";

/**
 * The analyze stage's four narrow Result writes (PRD 5), kept as free functions so the repository class
 * delegates one-liners. Each touches ONLY its reserved/owned nullable column(s) and never `status` —
 * the only status transition this stage performs is `recordExclusion` (Filter's guarded write, reused).
 */

/** Ratchet rung 2 (snippet-Verify): the interim score overwrites the provisional rung; no other column. */
export function setInterimMatchScore(
	db: Database,
	resultId: string,
	score: number,
): Promise<unknown> {
	return db
		.update(results)
		.set({ matchScore: score })
		.where(eq(results.id, resultId));
}

/** snippet-Classify: provisional Content Type only. */
export function setProvisionalContentType(
	db: Database,
	resultId: string,
	type: ContentType,
): Promise<unknown> {
	return db
		.update(results)
		.set({ contentType: type })
		.where(eq(results.id, resultId));
}

/**
 * The fused-call write: match_score (final rung, overwriting interim), verification_status,
 * content_type, sentiment, takeaway together — Verify/Classify/Enhance distinct fields, one durable
 * write.
 */
export function applyFullTextOutcome(
	db: Database,
	resultId: string,
	outcome: FullTextOutcome,
): Promise<unknown> {
	return db
		.update(results)
		.set({
			contentType: outcome.contentType,
			matchScore: outcome.matchScore,
			sentiment: outcome.sentiment,
			takeaway: outcome.takeaway,
			verificationStatus: outcome.verificationStatus,
		})
		.where(eq(results.id, resultId));
}

/**
 * On a successful Extract: persist the Extracted full text into the nullable `extracted_content`
 * column so PRD 07's Page can display it ("Extracted via Tavily"). A Result whose Extract failed is
 * left NULL. Display-only — never copied into exclusion_detail, a log, or a span attribute.
 */
export function setExtractedContent(
	db: Database,
	resultId: string,
	content: string,
): Promise<unknown> {
	return db
		.update(results)
		.set({ extractedContent: content })
		.where(eq(results.id, resultId));
}
