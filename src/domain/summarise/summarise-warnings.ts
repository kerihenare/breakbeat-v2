import { type Warning, warning } from "../job/warning";

/** Closed set of summarise Warning types, namespaced under `summarise.`. */
export const SUMMARISE_WARNING = {
	// no surviving (`included`) Results — nothing to digest.
	summariseEmpty: "summarise.summarise_empty",
	// adapter error OR Zod-validation failure — Summary absent.
	summariseFailed: "summarise.summarise_failed",
} as const;

/**
 * Messages are fixed and NON-ECHOING — never raw snippet text, raw model output,
 * or a provider error body. Both are partial-success notes: the reviewable list
 * is intact, only the digest is missing. There is no Job-failing path here.
 */
export const summariseWarnings = {
	summariseEmpty: (): Warning =>
		warning(
			SUMMARISE_WARNING.summariseEmpty,
			"No in-scope coverage survived to digest; the Job-level Summary was not produced.",
		),
	summariseFailed: (): Warning =>
		warning(
			SUMMARISE_WARNING.summariseFailed,
			"The Summarise digest could not be produced; the reviewable list is unaffected.",
		),
};
