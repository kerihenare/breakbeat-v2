/**
 * ADR 0005: the recency PRECISION backstop. True when the Published Date is strictly older than
 * `now` minus `horizonMonths`. A NULL (or unparseable) date is NEVER excluded — symmetric with
 * Collapse's undated-copy rule. No network, no model.
 */
export function isOutOfWindow(
	publishedDate: string | null,
	now: Date,
	horizonMonths: number,
): boolean {
	if (publishedDate === null) return false;
	const published = Date.parse(publishedDate);
	if (Number.isNaN(published)) return false;
	const cutoff = new Date(now);
	cutoff.setUTCMonth(cutoff.getUTCMonth() - horizonMonths);
	return published < cutoff.getTime();
}
