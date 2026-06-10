import type {
	FullTextAnalysisInput,
	FullTextAnalysisPort,
} from "../../application/analyze/ports/full-text-analysis.port";
import {
	type FusedAnalysis,
	fusedAnalysisSchema,
} from "../../domain/analyze/fused-analysis";
import { fullTextPrompt } from "./analyze-prompts";
import { type AnthropicClient, structuredCall } from "./anthropic-structured";

/**
 * The ONE fused Haiku call per Extracted Result (ADR 0003). One messages.create whose prompt carries
 * the Extracted fullText, the positive BrandContext, and the negativeBoost, returning the four outputs
 * of the three distinct stages together. Zod-parses against fusedAnalysisSchema VERBATIM and returns the
 * validated FusedAnalysis, or { failed: true } on any malformed / schema-violating / transport / timeout
 * failure — an unvalidated object never crosses the port (the anti-echo boundary). Not split into three.
 */
export class FullTextAnalysisAdapter implements FullTextAnalysisPort {
	private readonly schema: ReturnType<typeof fusedAnalysisSchema>;

	constructor(
		private readonly client: AnthropicClient,
		private readonly model: string,
		private readonly timeoutMs: number,
		takeawayMaxLength: number,
	) {
		this.schema = fusedAnalysisSchema(takeawayMaxLength);
	}

	async analyze(
		input: FullTextAnalysisInput,
	): Promise<FusedAnalysis | { failed: true }> {
		const json = await structuredCall(
			this.client,
			this.model,
			512,
			fullTextPrompt(input),
		);
		const parsed = this.schema.safeParse(json);
		return parsed.success ? parsed.data : { failed: true };
	}
}
