import { z } from "zod";
import type {
	SnippetEvidence,
	SnippetJudgementPort,
	SnippetVerifyInput,
} from "../../application/analyze/ports/snippet-judgement.port";
import {
	CONTENT_TYPES,
	type ContentType,
} from "../../domain/analyze/content-type";
import { snippetClassifyPrompt, snippetVerifyPrompt } from "./analyze-prompts";
import { type AnthropicClient, structuredCall } from "./anthropic-structured";

const verifySchema = z
	.object({ entityMatchScore: z.number().min(0).max(100) })
	.strip();
const classifySchema = z.object({ contentType: z.enum(CONTENT_TYPES) }).strip();

/**
 * Owns both cheap Pass-1 structured Haiku calls. snippet-Verify returns ONLY the score (the Exclude
 * decision is the domain's classifyScore). Both calls inject the SnippetEvidence, the positive
 * BrandContext, and the negativeBoost VERBATIM (ADR 0001 — collected collision contexts under the
 * assertive framing, never re-derived diffs). On any transport/quota/timeout/parse/schema failure the
 * method returns { failed: true } — never a throw, never an unvalidated object (anti-echo).
 */
export class SnippetJudgementAdapter implements SnippetJudgementPort {
	constructor(
		private readonly client: AnthropicClient,
		private readonly model: string,
		private readonly timeoutMs: number,
	) {}

	async verifySnippet(
		input: SnippetVerifyInput,
	): Promise<{ interimMatchScore: number } | { failed: true }> {
		const json = await structuredCall(
			this.client,
			this.model,
			256,
			snippetVerifyPrompt(input),
		);
		const parsed = verifySchema.safeParse(json);
		return parsed.success
			? { interimMatchScore: parsed.data.entityMatchScore }
			: { failed: true };
	}

	async classifySnippet(
		evidence: SnippetEvidence,
	): Promise<{ contentType: ContentType } | { failed: true }> {
		const json = await structuredCall(
			this.client,
			this.model,
			256,
			snippetClassifyPrompt(evidence),
		);
		const parsed = classifySchema.safeParse(json);
		return parsed.success
			? { contentType: parsed.data.contentType }
			: { failed: true };
	}
}
