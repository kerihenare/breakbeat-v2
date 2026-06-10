import { z } from "zod";
import type {
	SearchSourceResult,
	TavilySearchPort,
} from "../../application/search/ports/tavily-search.port";
import type { SearchQuery } from "../../domain/search/search-query";

// The subset of the @tavily/core client surface we depend on (kept local; the port hides it).
export type TavilyClient = {
	search(query: string, options?: Record<string, unknown>): Promise<unknown>;
};

const responseSchema = z
	.object({
		results: z.array(
			z
				.object({
					content: z.string().nullish(),
					published_date: z.string().nullish(),
					publishedDate: z.string().nullish(),
					score: z.number().nullish(),
					snippet: z.string().nullish(),
					title: z.string().nullish(),
					url: z.string(),
				})
				.passthrough(),
		),
	})
	.passthrough();

/** Primary recall. Translates every transport/quota/parse failure into { hits: [], failed: true }. */
export class TavilySearchAdapter implements TavilySearchPort {
	constructor(private readonly client: TavilyClient) {}

	async search(query: SearchQuery): Promise<SearchSourceResult> {
		try {
			const options: Record<string, unknown> = {};
			if (query.timeSlice) {
				options.startDate = query.timeSlice.startDate;
				options.endDate = query.timeSlice.endDate;
			}
			const raw = await this.client.search(query.text, options);
			const parsed = responseSchema.safeParse(raw);
			if (!parsed.success) return { failed: true, hits: [] };
			return {
				failed: false,
				hits: parsed.data.results.map((r) => ({
					publishedDate: r.publishedDate ?? r.published_date ?? null,
					relevance: r.score ?? null,
					snippet: r.content ?? r.snippet ?? "",
					title: r.title ?? "",
					url: r.url,
				})),
			};
		} catch {
			return { failed: true, hits: [] };
		}
	}
}
