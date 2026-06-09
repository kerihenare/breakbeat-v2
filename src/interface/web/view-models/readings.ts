/**
 * NULL-state readings and simple formatters (PRD 7 §NULL-state labelling).
 * "Unverified" / "Unclassified" are *readings* of NULL computed at render time
 * — never stored, never written back.
 */

export function verificationReading(status: string | null): string {
	if (status === "verified") return "Verified";
	if (status === "uncertain") return "Uncertain match";
	return "Unverified"; // NULL — Verify did not run / no basis
}

export interface SentimentView {
	readonly label: string;
	readonly tone: "green" | "ink" | "pink";
}

export function sentimentView(sentiment: string | null): SentimentView | null {
	switch (sentiment) {
		case "positive":
			return { label: "Positive", tone: "green" };
		case "neutral":
			return { label: "Neutral", tone: "ink" };
		case "negative":
			return { label: "Negative", tone: "pink" };
		default:
			return null; // NULL — Enhance did not run
	}
}

/** A Result's date, as shown on every row. NULL is never guessed — shows "—". */
export function formatDate(date: Date | null): string {
	if (!date) return "—";
	return date.toISOString().slice(0, 10);
}

export function formatDomain(domain: string | null): string {
	return domain && domain.length > 0 ? domain : "—";
}

/** Human-readable label for an exclusion code (the reason shown on excluded rows). */
const EXCLUSION_LABELS: Record<string, string> = {
	aggregator: "Aggregator",
	duplicate: "Duplicate",
	ecommerce_review: "Ecommerce / review",
	off_topic: "Off topic",
	out_of_window: "Outside 36-month window",
	own_channel: "Own channel",
};

export function exclusionReading(code: string | null): string {
	if (!code) return "Excluded";
	return EXCLUSION_LABELS[code] ?? "Excluded";
}
