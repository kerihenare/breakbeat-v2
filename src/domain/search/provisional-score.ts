/**
 * A backstop hit has no native relevance, so it takes a fixed floor that sorts
 * BENEATH every Tavily-scored row until Verify ratchets it. Honest (least-
 * provenanced rescue) and transient (Verify's interim score replaces it within
 * seconds).
 */
export const BACKSTOP_PROVISIONAL_SCORE = 0;

/**
 * The provisional rung of the three-stage Match Score ratchet (Verify writes
 * interim then final). Maps Tavily's native 0-1 relevance into the 0-100
 * ordering key; a RETURNED hit always scores ≥ 1.
 */
export function tavilyProvisionalScore(relevance: number | null): number {
	if (relevance === null || relevance <= 0) return 1;
	return Math.min(100, Math.max(1, Math.round(relevance * 100)));
}
