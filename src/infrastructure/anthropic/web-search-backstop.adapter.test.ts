import { describe, expect, it, vi } from "vitest";
import { WebSearchBackstopAdapter } from "./web-search-backstop.adapter";

// Fake matching client.messages.create — returns content blocks including a web_search_tool_result.
const fakeAnthropic = (impl: () => unknown) => ({
	messages: { create: vi.fn(impl) },
});

describe("WebSearchBackstopAdapter", () => {
	it("maps web_search tool results to NormalizedHit with null relevance and date", async () => {
		const client = fakeAnthropic(async () => ({
			content: [
				{ text: "Here are results", type: "text" },
				{
					content: [
						{
							page_age: "2026",
							title: "Rescue 1",
							type: "web_search_result",
							url: "https://rescue/1",
						},
						{
							title: "Rescue 2",
							type: "web_search_result",
							url: "https://rescue/2",
						},
					],
					type: "web_search_tool_result",
				},
			],
			model: "claude-haiku-4-5-20251001",
			stop_reason: "end_turn",
			usage: { input_tokens: 100, output_tokens: 50 },
		}));
		const out = await new WebSearchBackstopAdapter(
			client as never,
			"claude-haiku-4-5-20251001",
		).search("Aglow");
		expect(out.failed).toBe(false);
		expect(out.hits).toEqual([
			{
				publishedDate: null,
				relevance: null,
				snippet: "",
				title: "Rescue 1",
				url: "https://rescue/1",
			},
			{
				publishedDate: null,
				relevance: null,
				snippet: "",
				title: "Rescue 2",
				url: "https://rescue/2",
			},
		]);
	});

	it("returns { hits: [], failed: true } when the SDK throws", async () => {
		const client = fakeAnthropic(async () => {
			throw new Error("rate limit");
		});
		expect(
			await new WebSearchBackstopAdapter(client as never, "m").search("Aglow"),
		).toEqual({ failed: true, hits: [] });
	});

	it("returns no hits (not a failure) when the model used no web_search tool", async () => {
		const client = fakeAnthropic(async () => ({
			content: [{ text: "no search", type: "text" }],
			model: "m",
			usage: {},
		}));
		const out = await new WebSearchBackstopAdapter(client as never, "m").search(
			"Aglow",
		);
		expect(out).toEqual({ failed: false, hits: [] });
	});
});
