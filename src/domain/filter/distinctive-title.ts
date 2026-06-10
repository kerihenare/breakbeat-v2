import type { FilterConfig } from "./filter-config";
import { normalizeTitle } from "./normalize-title";

const STOP_WORDS = new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"of",
	"to",
	"in",
	"on",
	"for",
	"with",
	"at",
	"by",
	"from",
	"as",
	"is",
	"are",
	"its",
	"new",
	"update",
	"updates",
	"news",
	"press",
	"release",
	"announcement",
	"announces",
	"report",
	"q1",
	"q2",
	"q3",
	"q4",
	"company",
	"inc",
	"ltd",
]);

/**
 * A normalized key may anchor a cluster only when it is DISTINCTIVE: ≥ minDistinctiveTokens
 * meaningful tokens remain after removing the company-name tokens and stop-words. A bare name or a
 * generic phrase ("Funding Announcement") is never a collapse key — each such Result stays a singleton.
 */
export function isDistinctive(
	normalizedKey: string,
	companyName: string,
	config: FilterConfig,
): boolean {
	const companyTokens = new Set(
		normalizeTitle(companyName).split(" ").filter(Boolean),
	);
	const meaningful = normalizedKey
		.split(" ")
		.filter((t) => t !== "" && !STOP_WORDS.has(t) && !companyTokens.has(t));
	return meaningful.length >= config.minDistinctiveTokens;
}
