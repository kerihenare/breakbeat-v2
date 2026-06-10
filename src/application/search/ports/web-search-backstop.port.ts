import type { SearchSourceResult } from "./tavily-search.port";

/** Escalation BACKSTOP only (Anthropic web_search). Invoked solely when the stage's gate authorises it. */
export interface WebSearchBackstopPort {
	search(companyName: string): Promise<SearchSourceResult>; // same normalized shape; relevance/date null
}

export const WEB_SEARCH_BACKSTOP_PORT = Symbol("WebSearchBackstopPort");
