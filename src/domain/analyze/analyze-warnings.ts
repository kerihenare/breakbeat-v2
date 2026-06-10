import { type Warning, warning } from "../job/warning";

/** Closed set of analyze Warning types, namespaced under `analyze.`. */
export const ANALYZE_WARNING = {
	// Job-level: every Classify attempt failed; one Warning, never a failure.
	classifyTotallyFailed: "analyze.classify_totally_failed",
	// per-Result: sentiment/takeaway NULL; row still shows.
	enhanceFailed: "analyze.enhance_failed",
	// per-Result: Extract failed; stays included, interim score + provisional type kept, verification_status NULL.
	extractFailed: "analyze.extract_failed",
	// per-Result: re-Classify field unusable; content_type left NULL.
	fullTextClassifyFailed: "analyze.full_text_classify_failed",
	// Job-level: name-only Job, no brand context; Verify yields the Unverified (NULL) reading.
	noBrandContext: "analyze.no_brand_context",
	// per-Result: snippet-Classify failed; provisional content_type NULL.
	snippetClassifyFailed: "analyze.snippet_classify_failed",
} as const;

/**
 * Builders carrying COUNTS and ids only — never raw snippet text, page text, prompt, completion, or a
 * provider error body (anti-echo). Per-Result Warnings are aggregated by the shell (one Warning per
 * kind carrying a count, not one per Result); the Job-level Warnings fire at most once.
 */
export const analyzeWarnings = {
	classifyTotallyFailed: (): Warning =>
		warning(
			ANALYZE_WARNING.classifyTotallyFailed,
			"Every Classify attempt across the Job failed; the list is reviewable but untyped.",
		),
	enhanceFailed: (count: number): Warning =>
		warning(
			ANALYZE_WARNING.enhanceFailed,
			`${count} Result(s) failed Enhance; sentiment and takeaway left NULL.`,
		),
	extractFailed: (count: number): Warning =>
		warning(
			ANALYZE_WARNING.extractFailed,
			`${count} Result(s) failed Extract; each stays included with its interim score and provisional type, Unverified.`,
		),
	fullTextClassifyFailed: (count: number): Warning =>
		warning(
			ANALYZE_WARNING.fullTextClassifyFailed,
			`${count} Result(s) failed the full-text re-Classify; content_type left NULL (Unclassified).`,
		),
	noBrandContext: (): Warning =>
		warning(
			ANALYZE_WARNING.noBrandContext,
			"No resolved brand context (name-only Job); Verify yields the Unverified reading where it cannot confidently verify or Exclude.",
		),
	snippetClassifyFailed: (count: number): Warning =>
		warning(
			ANALYZE_WARNING.snippetClassifyFailed,
			`${count} Result(s) failed snippet-Classify; provisional content_type left NULL (Unclassified).`,
		),
};
