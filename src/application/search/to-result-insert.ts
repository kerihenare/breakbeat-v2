import { normalizeUrl } from "../../domain/search/normalize-url";
import {
	BACKSTOP_PROVISIONAL_SCORE,
	tavilyProvisionalScore,
} from "../../domain/search/provisional-score";
import type {
	ResultInsert,
	ResultSource,
} from "./ports/result-repository.port";
import type {
	NormalizedHit,
	SearchSourceResult,
} from "./ports/tavily-search.port";

/**
 * Pure mapping of a normalized hit + its source into an insertable born-
 * `included` Result. Tavily → provisional score from relevance; backstop → the
 * fixed floor. Search writes the provisional Match Score and the coverage facts
 * only — no verification_status, type, or exclusion.
 */
export function toResultInsert(
	hit: NormalizedHit,
	source: ResultSource,
): ResultInsert {
	return {
		matchScore:
			source === "tavily"
				? tavilyProvisionalScore(hit.relevance)
				: BACKSTOP_PROVISIONAL_SCORE,
		normalizedUrl: normalizeUrl(hit.url),
		publishedDate: hit.publishedDate,
		snippet: hit.snippet,
		source,
		title: hit.title,
		url: hit.url,
	};
}

/** Convenience: map a whole source result's hits. */
export function toResultInserts(
	result: SearchSourceResult,
	source: ResultSource,
): ResultInsert[] {
	return result.hits.map((h) => toResultInsert(h, source));
}
