/**
 * One surviving (`included`) Result's contribution to the digest: its snippet
 * plus its per-Result Enhancement. takeaway/sentiment are nullable — Enhance is
 * Warning-tolerant, so a surviving Result whose Enhance failed appears here
 * carrying its snippet with null Enhancement fields.
 */
export type SummariseInputItem = {
	readonly snippet: string;
	readonly takeaway: string | null;
	readonly sentiment: "positive" | "neutral" | "negative" | null;
};

/**
 * The SummarisePort's input contract: the target company (for the digest's
 * framing) + one item per surviving (`included`) Result. The digest is over
 * snippets + Enhancements, NEVER full page text.
 */
export type SummariseInput = {
	readonly companyName: string;
	readonly items: readonly SummariseInputItem[];
};

/**
 * The repository's read-model row for the summarise input — re-exported here so
 * the domain selection rule depends on a shape, not on the application port.
 * Mirrors `SummariseResultRow` (the ResultRepository read extension).
 */
export type SelectableResultRow = {
	readonly snippet: string;
	readonly takeaway: string | null;
	readonly sentiment: "positive" | "neutral" | "negative" | null;
	// Present only in the defence-in-depth mixed-status fixture.
	readonly status?: "included" | "excluded";
};
