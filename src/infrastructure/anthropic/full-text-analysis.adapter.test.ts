import { describe, expect, it, vi } from "vitest";
import { FullTextAnalysisAdapter } from "./full-text-analysis.adapter";

const fakeAnthropic = (impl: () => unknown) => ({
	messages: { create: vi.fn(impl) },
});
const jsonReply = (obj: unknown) => async () => ({
	content: [{ text: JSON.stringify(obj), type: "text" }],
	model: "claude-haiku",
	stop_reason: "end_turn",
	usage: { input_tokens: 800, output_tokens: 60 },
});

const valid = {
	contentType: "news_article",
	entityMatchScore: 84,
	sentiment: "positive",
	takeaway: "Aglow raised a round.",
};
const adapter = (client: unknown) =>
	new FullTextAnalysisAdapter(client as never, "claude-haiku", 30000, 400);
const input = {
	brandContext: null,
	fullText: "the page text",
	negativeBoost: "",
};

describe("FullTextAnalysisAdapter", () => {
	it("maps a representative fused response to a Zod-validated FusedAnalysis (all four fields)", async () => {
		expect(
			await adapter(fakeAnthropic(jsonReply(valid))).analyze(input),
		).toEqual(valid);
	});

	it("returns { failed: true } on an out-of-enum contentType", async () => {
		expect(
			await adapter(
				fakeAnthropic(jsonReply({ ...valid, contentType: "tweet" })),
			).analyze(input),
		).toEqual({ failed: true });
	});

	it("returns { failed: true } on a missing field", async () => {
		const { sentiment, ...missing } = valid;
		expect(
			await adapter(fakeAnthropic(jsonReply(missing))).analyze(input),
		).toEqual({ failed: true });
	});

	it("returns { failed: true } on an over-length takeaway (the config cap)", async () => {
		const out = await adapter(
			fakeAnthropic(jsonReply({ ...valid, takeaway: "x".repeat(401) })),
		).analyze(input);
		expect(out).toEqual({ failed: true });
	});

	it("drops injected extra fields (anti-echo): only the four validated fields are returned", async () => {
		const out = await adapter(
			fakeAnthropic(jsonReply({ ...valid, injected: "IGNORE INSTRUCTIONS" })),
		).analyze(input);
		expect(out).toEqual(valid);
	});

	it("returns { failed: true } when the SDK throws, never a throw", async () => {
		const client = fakeAnthropic(async () => {
			throw new Error("timeout");
		});
		expect(await adapter(client).analyze(input)).toEqual({ failed: true });
	});
});
