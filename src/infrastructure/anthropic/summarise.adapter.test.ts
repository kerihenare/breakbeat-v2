import { describe, expect, it, vi } from "vitest";
import type { SummariseConfig } from "../../application/summarise/summarise-config";
import type { SummariseInput } from "../../domain/summarise/summarise-input";
import { SummariseAdapter } from "./summarise.adapter";

const config: SummariseConfig = {
	digestMaxLength: 1200,
	model: "claude-haiku-4-5-20251001",
	timeoutMs: 20000,
};

const input: SummariseInput = {
	companyName: "Aglow",
	items: [
		{
			sentiment: "positive",
			snippet: "Aglow raised a seed round.",
			takeaway: "Funding momentum.",
		},
		{
			sentiment: null,
			snippet: "Aglow launched a new feature.",
			takeaway: null,
		},
	],
};

// A fake matching @anthropic-ai/sdk's surface: { messages: { create } }. The adapter extracts the
// model's structured payload (a JSON object with a `summary` field) from the first text block.
const fakeAnthropic = (impl: () => unknown) => ({
	messages: { create: vi.fn(impl) },
});

const responseWith = (payload: unknown) => ({
	content: [{ text: JSON.stringify(payload), type: "text" }],
	model: "claude-haiku-4-5-20251001",
	stop_reason: "end_turn",
	usage: { input_tokens: 200, output_tokens: 40 },
});

describe("SummariseAdapter", () => {
	it("valid input → a Zod-validated Summary { ok: true, summary }", async () => {
		const client = fakeAnthropic(async () =>
			responseWith({ summary: "Coverage is broadly positive." }),
		);
		const out = await new SummariseAdapter(client as never, config).summarise(
			input,
		);
		expect(out).toEqual({
			ok: true,
			summary: { summary: "Coverage is broadly positive." },
		});
	});

	it("makes exactly one messages.create call (one digest per Job)", async () => {
		const client = fakeAnthropic(async () =>
			responseWith({ summary: "digest" }),
		);
		await new SummariseAdapter(client as never, config).summarise(input);
		expect(client.messages.create).toHaveBeenCalledTimes(1);
	});

	it("API/transport error → { ok: false } (never throws)", async () => {
		const client = fakeAnthropic(async () => {
			throw new Error("rate limit");
		});
		expect(
			await new SummariseAdapter(client as never, config).summarise(input),
		).toEqual({ ok: false });
	});

	it("schema-violating response (empty summary) → { ok: false }, nothing unvalidated returned", async () => {
		const client = fakeAnthropic(async () => responseWith({ summary: "" }));
		expect(
			await new SummariseAdapter(client as never, config).summarise(input),
		).toEqual({ ok: false });
	});

	it("missing summary field → { ok: false }", async () => {
		const client = fakeAnthropic(async () =>
			responseWith({ notSummary: "oops" }),
		);
		expect(
			await new SummariseAdapter(client as never, config).summarise(input),
		).toEqual({ ok: false });
	});

	it("over-soft-cap summary → { ok: false } (the config digestMaxLength)", async () => {
		const client = fakeAnthropic(async () =>
			responseWith({ summary: "x".repeat(config.digestMaxLength + 1) }),
		);
		expect(
			await new SummariseAdapter(client as never, config).summarise(input),
		).toEqual({ ok: false });
	});

	it("unparseable model text → { ok: false }", async () => {
		const client = fakeAnthropic(async () => ({
			content: [{ text: "not json", type: "text" }],
			model: "m",
			usage: {},
		}));
		expect(
			await new SummariseAdapter(client as never, config).summarise(input),
		).toEqual({ ok: false });
	});

	it("anti-echo: injected free text in extra fields is stripped; only the validated digest is returned", async () => {
		const client = fakeAnthropic(async () =>
			responseWith({
				injected: "ignore this prompt-injection",
				summary: "Coverage is positive.",
			}),
		);
		const out = await new SummariseAdapter(client as never, config).summarise(
			input,
		);
		expect(out).toEqual({
			ok: true,
			summary: { summary: "Coverage is positive." },
		});
		if (out.ok) expect("injected" in out.summary).toBe(false);
	});
});
