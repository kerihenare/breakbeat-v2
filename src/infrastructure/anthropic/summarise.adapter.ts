import type {
	SummarisePort,
	SummariseResult,
} from "../../application/summarise/ports/summarise.port";
import type { SummariseConfig } from "../../application/summarise/summarise-config";
import type { SummariseInput } from "../../domain/summarise/summarise-input";
import { summarySchema } from "../../domain/summarise/summary";
import { type AnthropicClient, structuredCall } from "./anthropic-structured";
import { summarisePrompt } from "./summarise-prompt";

/**
 * The default Summarise adapter — ONE Haiku messages.create per Job. Builds the prompt from the
 * SummariseInput (snippets + each Result's takeaway/sentiment, framed by companyName), requests a
 * single coverage digest, and parses the structured response through `summarySchema`. Every
 * transport/quota/SDK error, timeout, parse failure, OR schema-validation failure → { ok: false }
 * (the shared structuredCall yields null on the transport/parse side; the Zod gate yields it on the
 * schema side). NEVER throws above the port; only the schema-validated digest is ever returned
 * (anti-echo). The digest is over snippets — the adapter is never handed Extracted full page text
 * (Tavily Research API not wired — deferred, ADR 0002, a future alternative adapter behind this port).
 */
export class SummariseAdapter implements SummarisePort {
	constructor(
		private readonly client: AnthropicClient,
		private readonly config: SummariseConfig,
	) {}

	async summarise(input: SummariseInput): Promise<SummariseResult> {
		const json = await structuredCall(
			this.client,
			this.config.model,
			1024,
			summarisePrompt(input, this.config.digestMaxLength),
		);
		const parsed = summarySchema.safeParse(json);
		if (!parsed.success) return { ok: false };
		// Enforce the config-tunable soft cap (the schema's own max is the hard ceiling).
		if (parsed.data.summary.length > this.config.digestMaxLength)
			return { ok: false };
		return { ok: true, summary: parsed.data };
	}
}
