import type {
	SelectableResultRow,
	SummariseInput,
	SummariseInputItem,
} from "./summarise-input";

/**
 * Pure, no I/O. Shapes the repository's `included` rows into the SummarisePort's
 * input. The repository query (findIncludedForSummary) is the PRIMARY "Excluded
 * Results never feed the digest" guarantee; this rule is the SECOND line of
 * defence — if a `status` is carried on a row, an `excluded` row is dropped here
 * too, so the guarantee holds at the domain boundary, not just in SQL. Order is
 * preserved verbatim. takeaway/sentiment are passed through (null-tolerant): a
 * surviving Result with a missing Enhancement is digested snippet-only and is
 * never dropped for it.
 */
export function selectSummariseInput(
	rows: readonly SelectableResultRow[],
	companyName: string,
): SummariseInput {
	const items: SummariseInputItem[] = rows
		.filter((r) => r.status !== "excluded")
		.map((r) => ({
			sentiment: r.sentiment,
			snippet: r.snippet,
			takeaway: r.takeaway,
		}));
	return { companyName, items };
}
