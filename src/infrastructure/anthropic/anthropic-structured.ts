import { z } from "zod";
import type { BrandContext } from "../../domain/resolve/brand-context";

// The subset of the @anthropic-ai/sdk client surface we depend on (kept local; the ports hide it).
export type AnthropicClient = {
	messages: { create(body: Record<string, unknown>): Promise<unknown> };
};

const responseSchema = z
	.object({
		content: z.array(
			z.object({ text: z.string().optional(), type: z.string() }).passthrough(),
		),
	})
	.passthrough();

/** Renders the positive BrandContext lines Verify leans on; a name-only Job has none (anti-echo-safe). */
export function brandLines(brandContext: BrandContext | null): string {
	if (brandContext === null)
		return "No brand context is available (name-only Job).";
	return [
		`Value proposition: ${brandContext.valueProposition ?? "(unknown)"}`,
		`Target audience: ${brandContext.targetAudienceSegments.join(", ") || "(unknown)"}`,
		`Products & services: ${brandContext.productsAndServices.join(", ") || "(unknown)"}`,
	].join("\n");
}

/**
 * One structured Haiku call shared by both analyze adapters: sends the prompt, extracts the first text
 * content block, and returns the parsed JSON object — or `null` on any transport/quota/timeout/parse
 * failure. Callers Zod-validate the result against their own schema (an unvalidated object never crosses
 * a port). Never throws; the fail-soft contract is the load-bearing robustness guarantee (anti-echo).
 */
export async function structuredCall(
	client: AnthropicClient,
	model: string,
	maxTokens: number,
	prompt: string,
): Promise<unknown> {
	try {
		const raw = await client.messages.create({
			max_tokens: maxTokens,
			messages: [{ content: prompt, role: "user" }],
			model,
		});
		const response = responseSchema.safeParse(raw);
		if (!response.success) return null;
		const text = response.data.content.find(
			(b) => typeof b.text === "string",
		)?.text;
		if (text === undefined) return null;
		return JSON.parse(text);
	} catch {
		return null;
	}
}
