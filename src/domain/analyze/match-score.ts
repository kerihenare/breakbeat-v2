/**
 * The three resolutions of the Match Score, each REPLACING the last:
 * - "provisional": Tavily's relevance, written by Search.
 * - "interim": snippet-Verify (this stage, Pass 1).
 * - "final": the fused full-text call's entityMatchScore (this stage, Pass 2 — authoritative).
 */
export type MatchScoreRung = "provisional" | "interim" | "final";

/**
 * Pure clamp + round into the 0-100 ordering key the UI sorts by descending at every moment.
 * "Latest rung overwrites": the function never reads or compares the prior persisted value —
 * WHICH rung is written is the orchestration shell's decision (interim vs final repository write),
 * and a later rung simply overwrites the earlier persisted number (no blend, no max, no average).
 */
export function ratchet(_rung: MatchScoreRung, score: number): number {
	return Math.min(100, Math.max(0, Math.round(score)));
}
