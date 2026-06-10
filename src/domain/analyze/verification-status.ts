/** The two STORED values. NULL ("Unverified") is never returned here — it is the ABSENCE of a write. */
export type VerificationStatus = "verified" | "uncertain";

export type Cutoffs = { readonly tExclude: number; readonly tVerified: number };

export type ScoreVerdict =
	| { readonly kind: "exclude" } //                                score < tExclude → off_topic
	| { readonly kind: "uncertain"; readonly status: "uncertain" } // [tExclude, tVerified)
	| { readonly kind: "verified"; readonly status: "verified" }; //  score ≥ tVerified

/**
 * verification_status AND the Exclude decision are BOTH pure functions of the score against one
 * cutoff pair — there is no independent verdict field the model returns. The SAME function runs at
 * both passes; only the `cutoffs` argument differs (snippet uses the lenient tExclude, full-text the
 * stricter one). The snippet pass does NOT persist `status`; only the full-text pass writes it.
 */
export function classifyScore(score: number, cutoffs: Cutoffs): ScoreVerdict {
	if (score < cutoffs.tExclude) return { kind: "exclude" };
	if (score < cutoffs.tVerified)
		return { kind: "uncertain", status: "uncertain" };
	return { kind: "verified", status: "verified" };
}
