import type { ContentType } from "./content-type";
import type { FusedAnalysis } from "./fused-analysis";
import { ratchet } from "./match-score";
import type { Sentiment } from "./sentiment";
import {
	type Cutoffs,
	classifyScore,
	type VerificationStatus,
} from "./verification-status";

/** The persistable shape the full-text pass produces (mirrors the repository's FullTextOutcome). */
export type FullTextWrite = {
	readonly matchScore: number;
	readonly verificationStatus: VerificationStatus;
	readonly contentType: ContentType;
	readonly sentiment: Sentiment;
	readonly takeaway: string;
};

/**
 * Pure mapping from a validated FusedAnalysis to the durable decision, against the STRICT full-text
 * cutoffs. `exclude` → the look-alike caught on the page (the Verification flip): the shell writes
 * off_topic/"LLM" and persists no Enhance. `write` → the final rung (overwrites interim) + status +
 * re-Classify + Enhance, applied in one durable write. No I/O — the shell performs the writes.
 */
export function decideFullText(
	analysis: FusedAnalysis,
	cutoffs: Cutoffs,
): { kind: "exclude" } | { kind: "write"; write: FullTextWrite } {
	const verdict = classifyScore(analysis.entityMatchScore, cutoffs);
	if (verdict.kind === "exclude") return { kind: "exclude" };
	return {
		kind: "write",
		write: {
			contentType: analysis.contentType,
			matchScore: ratchet("final", analysis.entityMatchScore),
			sentiment: analysis.sentiment,
			takeaway: analysis.takeaway,
			verificationStatus: verdict.status,
		},
	};
}
