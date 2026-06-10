/**
 * The single low-yield gate (ADR 0002). `distinctBroadResults` is the count of
 * Results ACTUALLY inserted by the broad set (post-URL-dedup) — never raw hits
 * returned: overlapping broad queries return one story many times, and counting
 * raw hits would let duplicates mask a thin run and suppress the escalation a
 * borderline company most needs. One scalar threshold authorises BOTH the
 * Angle/type-targeted expansion and the Anthropic backstop.
 */
export function shouldEscalate(
	distinctBroadResults: number,
	threshold: number,
): boolean {
	return distinctBroadResults < threshold;
}
