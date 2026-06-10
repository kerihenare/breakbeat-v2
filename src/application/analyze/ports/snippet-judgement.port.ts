import type { ContentType } from "../../../domain/analyze/content-type";
import type { BrandContext } from "../../../domain/resolve/brand-context";

/** Title + snippet + URL only — the cheap Pass-1 evidence. */
export type SnippetEvidence = {
	readonly url: string;
	readonly title: string;
	readonly snippet: string;
};

export type SnippetVerifyInput = {
	readonly evidence: SnippetEvidence;
	readonly brandContext: BrandContext | null; // positive signal: value proposition / audience segments / products & services
	readonly negativeBoost: string; //             ADR 0001: collected collision contexts, verbatim — NOT pre-computed diffs
};

/** The two cheap Pass-1 judgements (Anthropic Haiku). */
export interface SnippetJudgementPort {
	/** snippet-Verify: returns ONLY the interim Match Score (0–100). Exclude-vs-proceed is DERIVED (classifyScore) — no verdict field. */
	verifySnippet(
		input: SnippetVerifyInput,
	): Promise<{ interimMatchScore: number } | { failed: true }>;
	/** snippet-Classify: provisional Content Type from the same evidence (seven + other). */
	classifySnippet(
		evidence: SnippetEvidence,
	): Promise<{ contentType: ContentType } | { failed: true }>;
}

export const SNIPPET_JUDGEMENT_PORT = Symbol("SnippetJudgementPort");
