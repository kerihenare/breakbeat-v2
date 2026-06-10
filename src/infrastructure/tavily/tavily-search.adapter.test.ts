import { describe, expect, it, vi } from "vitest";
import type { SearchQuery } from "../../domain/search/search-query";
import { TavilySearchAdapter } from "./tavily-search.adapter";

const broad: SearchQuery = { kind: "broad", text: "Aglow", timeSlice: null };
const sliced: SearchQuery = {
	kind: "angle",
	text: '"Aglow" news',
	timeSlice: { endDate: "2026-06-09", startDate: "2025-06-09" },
};

// A fake matching @tavily/core's client surface: { search(query, options) }.
const fakeClient = (impl: (q: string, o: unknown) => unknown) => ({
	search: vi.fn(impl),
});

describe("TavilySearchAdapter", () => {
	it("maps the client response to NormalizedHit", async () => {
		const client = fakeClient(async () => ({
			results: [
				{
					content: "snippet A",
					publishedDate: "2026-01-01",
					score: 0.91,
					title: "A",
					url: "https://site/a",
				},
				{
					content: "snippet B",
					publishedDate: null,
					score: 0.4,
					title: "B",
					url: "https://site/b",
				},
			],
		}));
		const adapter = new TavilySearchAdapter(client as never);
		const out = await adapter.search(broad);
		expect(out.failed).toBe(false);
		expect(out.hits).toEqual([
			{
				publishedDate: "2026-01-01",
				relevance: 0.91,
				snippet: "snippet A",
				title: "A",
				url: "https://site/a",
			},
			{
				publishedDate: null,
				relevance: 0.4,
				snippet: "snippet B",
				title: "B",
				url: "https://site/b",
			},
		]);
	});

	it("passes a Time Slice through as the client's date parameters", async () => {
		const client = fakeClient(async () => ({ results: [] }));
		await new TavilySearchAdapter(client as never).search(sliced);
		const [query, options] = client.search.mock.calls[0];
		expect(query).toBe('"Aglow" news');
		expect(options).toMatchObject({
			endDate: "2026-06-09",
			startDate: "2025-06-09",
		});
	});

	it("returns { hits: [], failed: true } when the client throws", async () => {
		const client = fakeClient(async () => {
			throw new Error("quota");
		});
		expect(
			await new TavilySearchAdapter(client as never).search(broad),
		).toEqual({ failed: true, hits: [] });
	});

	it("returns { hits: [], failed: true } when the response fails to parse", async () => {
		const client = fakeClient(async () => ({ unexpected: true }));
		expect(
			await new TavilySearchAdapter(client as never).search(broad),
		).toEqual({ failed: true, hits: [] });
	});
});
