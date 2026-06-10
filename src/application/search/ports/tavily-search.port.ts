import type { SearchQuery } from "../../../domain/search/search-query";

export type NormalizedHit = {
	url: string;
	title: string;
	snippet: string;
	relevance: number | null; // Tavily's native 0-1 score; null for the backstop
	publishedDate: string | null; // nullable, from hit metadata (ADR 0005)
};

export type SearchSourceResult = {
	hits: NormalizedHit[];
	failed: boolean; // true ⇒ this call failed as a transport/quota error (Warning-grade)
};

/** Primary recall, always run. Never throws — failure surfaces as { hits: [], failed: true }. */
export interface TavilySearchPort {
	search(query: SearchQuery): Promise<SearchSourceResult>;
}

export const TAVILY_SEARCH_PORT = Symbol("TavilySearchPort");
