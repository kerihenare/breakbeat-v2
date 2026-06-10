/** One 12-month start/end window (ISO yyyy-mm-dd). A recall tactic — never the recency filter. */
export type TimeSlice = {
	readonly startDate: string;
	readonly endDate: string;
};

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const minusMonths = (from: Date, months: number): Date => {
	const d = new Date(from);
	d.setUTCMonth(d.getUTCMonth() - months);
	return d;
};

/**
 * ADR 0005: consecutive non-overlapping windows tiling `horizonMonths` backward
 * from `now` (default 3 × 12-month windows over 36 months). `now` is injected so
 * the plan is deterministic under test. Slices shape which window a query fishes;
 * they Exclude nothing.
 */
export function buildTimeSlices(
	now: Date,
	horizonMonths = 36,
	windowMonths = 12,
): TimeSlice[] {
	const slices: TimeSlice[] = [];
	for (let offset = 0; offset < horizonMonths; offset += windowMonths) {
		slices.push({
			endDate: isoDate(minusMonths(now, offset)),
			startDate: isoDate(minusMonths(now, offset + windowMonths)),
		});
	}
	return slices;
}
