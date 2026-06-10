import type { ContentType } from "./content-type";

export type SnippetOutcome =
	| { readonly kind: "excluded" } // snippet-Verify Excluded off_topic — never Extracted
	| {
			readonly kind: "survived";
			readonly interimScore: number;
			readonly provisionalType: ContentType | null;
	  };

/**
 * Pure Extract-gating predicate. Extract runs ONLY for a Result whose snippet-Verify did NOT Exclude
 * it. snippet-Classify never gates — its provisional type rides along even into an Excluded row,
 * harmlessly. An Excluded-at-snippet Result is never Extracted and never reaches the fused call.
 */
export function survivedSnippetGates(outcome: SnippetOutcome): outcome is {
	kind: "survived";
	interimScore: number;
	provisionalType: ContentType | null;
} {
	return outcome.kind === "survived";
}
