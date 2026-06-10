export type AnalyzeConfig = {
	/** ~25 — the LENIENT snippet-pass exclude cutoff (cost gate, not the precision call). */
	readonly snippetTExclude: number;
	/** ~40 — the STRICTER full-text exclude cutoff (the precision call, made on the actual page). */
	readonly fullTextTExclude: number;
	/** ~70 — at/above → verified; shared by both passes. */
	readonly tVerified: number;
	/** Bounded per-Result fan-out (Extract + fused call) — keeps Tavily/Haiku in-flight bounded. */
	readonly extractConcurrency: number;
	/** The schema cap on the one validated free-text field (`takeaway`). */
	readonly takeawayMaxLength: number;
};

export const ANALYZE_CONFIG = Symbol("AnalyzeConfig");

/**
 * Asserts the lenient-snippet/strict-full-text invariant `snippetTExclude < fullTextTExclude ≤
 * tVerified` plus a positive concurrency, at config load. Returns the config so the provider can
 * `return assertAnalyzeConfig(...)`.
 */
export function assertAnalyzeConfig(config: AnalyzeConfig): AnalyzeConfig {
	if (!(config.snippetTExclude < config.fullTextTExclude)) {
		throw new Error(
			"AnalyzeConfig: snippetTExclude must be strictly less than fullTextTExclude (lenient snippet gate)",
		);
	}
	if (!(config.fullTextTExclude <= config.tVerified)) {
		throw new Error("AnalyzeConfig: fullTextTExclude must be ≤ tVerified");
	}
	if (!(config.extractConcurrency > 0)) {
		throw new Error(
			"AnalyzeConfig: extractConcurrency must be a positive integer",
		);
	}
	return config;
}
