import { describe, expect, it, vi } from "vitest";
import type { SnippetEvidence } from "../../application/analyze/ports/snippet-judgement.port";
import { SnippetJudgementAdapter } from "./snippet-judgement.adapter";

const evidence: SnippetEvidence = {
	snippet: "Aglow announced funding...",
	title: "Aglow raises a round",
	url: "https://news.example/aglow",
};

// Fake matching client.messages.create — returns a content block carrying a single JSON object.
const fakeAnthropic = (impl: () => unknown) => ({
	messages: { create: vi.fn(impl) },
});
const jsonReply = (obj: unknown) => async () => ({
	content: [{ text: JSON.stringify(obj), type: "text" }],
	model: "claude-haiku",
	stop_reason: "end_turn",
	usage: { input_tokens: 50, output_tokens: 10 },
});

const adapter = (client: unknown) =>
	new SnippetJudgementAdapter(client as never, "claude-haiku", 10000);

describe("SnippetJudgementAdapter — snippet-Verify", () => {
	it("maps a representative response to { interimMatchScore } (score-only, Zod-validated)", async () => {
		const out = await adapter(
			fakeAnthropic(jsonReply({ entityMatchScore: 72 })),
		).verifySnippet({ brandContext: null, evidence, negativeBoost: "" });
		expect(out).toEqual({ interimMatchScore: 72 });
	});

	it("returns { failed: true } on an out-of-range score (schema violation, never an unvalidated object)", async () => {
		const out = await adapter(
			fakeAnthropic(jsonReply({ entityMatchScore: 150 })),
		).verifySnippet({ brandContext: null, evidence, negativeBoost: "" });
		expect(out).toEqual({ failed: true });
	});

	it("returns { failed: true } when the SDK throws (quota/timeout/non-2xx), never a throw", async () => {
		const client = fakeAnthropic(async () => {
			throw new Error("rate limit");
		});
		expect(
			await adapter(client).verifySnippet({
				brandContext: null,
				evidence,
				negativeBoost: "",
			}),
		).toEqual({ failed: true });
	});
});

describe("SnippetJudgementAdapter — snippet-Classify", () => {
	it("maps a representative response to { contentType } over the enum", async () => {
		const out = await adapter(
			fakeAnthropic(jsonReply({ contentType: "news_article" })),
		).classifySnippet(evidence);
		expect(out).toEqual({ contentType: "news_article" });
	});

	it("returns { failed: true } on an out-of-enum contentType", async () => {
		const out = await adapter(
			fakeAnthropic(jsonReply({ contentType: "tweet" })),
		).classifySnippet(evidence);
		expect(out).toEqual({ failed: true });
	});

	it("returns { failed: true } when the response is not parseable JSON", async () => {
		const client = fakeAnthropic(async () => ({
			content: [{ text: "not json", type: "text" }],
		}));
		expect(await adapter(client).classifySnippet(evidence)).toEqual({
			failed: true,
		});
	});
});
