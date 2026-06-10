import { z } from "zod";
import type {
	ContentExtractionPort,
	ExtractionResult,
} from "../../application/analyze/ports/content-extraction.port";

// The subset of the @tavily/core client surface we depend on (kept local; the port hides it).
export type TavilyExtractClient = {
	extract(urls: string[], options?: Record<string, unknown>): Promise<unknown>;
};

const responseSchema = z
	.object({
		results: z.array(
			z
				.object({
					content: z.string().nullish(),
					raw_content: z.string().nullish(),
					rawContent: z.string().nullish(),
					url: z.string().nullish(),
				})
				.passthrough(),
		),
	})
	.passthrough();

/**
 * Tavily Extract behind ContentExtractionPort — Tavily retrieves the page server-side; we never
 * "fetch" a Result page. Maps a successful Extract to { kind: "extracted", fullText }; on non-2xx /
 * quota / network / timeout / empty extraction returns { kind: "extractionFailure" } — never a throw,
 * never an Exclusion. No scraped page text is put onto any future span attribute (anti-echo): the
 * fullText is consumed only by the fused call and persisted only to the display-only extracted_content.
 */
export class TavilyContentExtractionAdapter implements ContentExtractionPort {
	constructor(
		private readonly client: TavilyExtractClient,
		private readonly timeoutMs: number,
	) {}

	async extract(url: string): Promise<ExtractionResult> {
		try {
			const raw = await this.client.extract([url], { timeout: this.timeoutMs });
			const parsed = responseSchema.safeParse(raw);
			if (!parsed.success || parsed.data.results.length === 0) {
				return { kind: "extractionFailure" };
			}
			const first = parsed.data.results[0];
			const fullText =
				first.rawContent ?? first.raw_content ?? first.content ?? "";
			if (fullText.length === 0) return { kind: "extractionFailure" };
			return { fullText, kind: "extracted" };
		} catch {
			return { kind: "extractionFailure" };
		}
	}
}
