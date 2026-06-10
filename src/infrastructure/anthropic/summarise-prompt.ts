import type { SummariseInput } from "../../domain/summarise/summarise-input";

/**
 * Frames the surviving snippets + each Result's Enhancement; the digest is over snippets, NEVER
 * full page text (ADR 0002). Requests a single JSON object: { "summary": "<one short digest>" }.
 * The model's structured payload is the ONLY thing the adapter reads back (anti-echo enforced by the
 * Zod gate in the adapter).
 */
export function summarisePrompt(
	input: SummariseInput,
	digestMaxLength: number,
): string {
	const lines = input.items.map((item, i) => {
		const takeaway = item.takeaway ? ` Takeaway: ${item.takeaway}` : "";
		const sentiment = item.sentiment ? ` Sentiment: ${item.sentiment}` : "";
		return `${i + 1}. ${item.snippet}${takeaway}${sentiment}`;
	});
	return [
		`Write one short digest of what the coverage below, taken as a whole, says about "${input.companyName}".`,
		`Read across ALL items; do not summarise any single one. Keep it under ${digestMaxLength} characters.`,
		`Respond with ONLY a JSON object of the form {"summary": "<digest>"} and no other text.`,
		"",
		"Coverage:",
		...lines,
	].join("\n");
}
