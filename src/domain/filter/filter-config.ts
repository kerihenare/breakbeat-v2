/** Tuning for the deterministic rules; injected (never literals scattered through the predicates). */
export type FilterConfig = {
	horizonMonths: number; // 36 — out_of_window
	collapseWindowDays: number; // 14 — cluster window, anchored to the earliest member
	minDistinctiveTokens: number; // 5  — distinctiveness gate
	minClusterDomains: number; // 2  — wire-syndication signature
};
