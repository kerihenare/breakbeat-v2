import { z } from "zod";
import type { SearchSourceResult } from "../../application/search/ports/tavily-search.port";
import type { WebSearchBackstopPort } from "../../application/search/ports/web-search-backstop.port";

// The subset of the @anthropic-ai/sdk client surface we depend on (kept local; the port hides it).
export type AnthropicClient = {
	messages: { create(body: Record<string, unknown>): Promise<unknown> };
};

const resultBlockSchema = z
	.object({
		content: z.array(
			z.object({ title: z.string().nullish(), url: z.string() }).passthrough(),
		),
		type: z.literal("web_search_tool_result"),
	})
	.passthrough();

const responseSchema = z
	.object({ content: z.array(z.unknown()) })
	.passthrough();

/**
 * Escalation BACKSTOP only. Issues one web_search-enabled message around the
 * company name and harvests result URLs/titles. Anthropic gives neither a
 * relevance score nor a publish date, so both are null. Emits no raw model text
 * into any persisted/observable surface (anti-echo). Errors → failed.
 */
export class WebSearchBackstopAdapter implements WebSearchBackstopPort {
	constructor(
		private readonly client: AnthropicClient,
		private readonly model: string,
	) {}

	async search(companyName: string): Promise<SearchSourceResult> {
		try {
			const raw = await this.client.messages.create({
				max_tokens: 1024,
				messages: [
					{
						content: `Find recent third-party news and coverage about the company "${companyName}".`,
						role: "user",
					},
				],
				model: this.model,
				tools: [{ name: "web_search", type: "web_search_20260209" }],
			});
			const parsed = responseSchema.safeParse(raw);
			if (!parsed.success) return { failed: true, hits: [] };

			const hits = parsed.data.content.flatMap((block) => {
				const result = resultBlockSchema.safeParse(block);
				if (!result.success) return [];
				return result.data.content.map((r) => ({
					publishedDate: null,
					relevance: null,
					snippet: "",
					title: r.title ?? "",
					url: r.url,
				}));
			});
			return { failed: false, hits };
		} catch {
			return { failed: true, hits: [] };
		}
	}
}
