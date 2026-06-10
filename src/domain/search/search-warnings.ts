import { type Warning, warning } from "../job/warning";

export const SEARCH_WARNING = {
	backstopFailed: "search.backstop_failed",
	queriesPartiallyFailed: "search.queries_partially_failed",
} as const;

// Messages carry counts only — never raw query text, snippet text, or provider
// error bodies (anti-echo).
export const searchWarnings = {
	backstopFailed: (): Warning =>
		warning(
			SEARCH_WARNING.backstopFailed,
			"The Anthropic web-search backstop call failed during escalation; Tavily Results were still returned.",
		),
	queriesPartiallyFailed: (failedCount: number): Warning =>
		warning(
			SEARCH_WARNING.queriesPartiallyFailed,
			`${failedCount} search query/queries failed; a partial sweep was returned.`,
		),
};
