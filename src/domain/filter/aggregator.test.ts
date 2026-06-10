import { describe, expect, it } from "vitest";
import { isAggregator } from "./aggregator";
import type { FilterResult } from "./filter-result";

const r = (url: string): FilterResult => ({
	id: "r",
	publishedDate: null,
	snippet: "s",
	title: "t",
	url,
});

describe("isAggregator", () => {
	it("matches known aggregator hosts (full host, www stripped)", () => {
		expect(isAggregator(r("https://news.google.com/articles/abc"))).toBe(true);
		expect(isAggregator(r("https://www.flipboard.com/topic/aglow"))).toBe(true);
	});
	it("matches directory / index structural cues", () => {
		expect(isAggregator(r("https://example.com/tag/aglow"))).toBe(true);
		expect(isAggregator(r("https://example.com/search?q=aglow"))).toBe(true);
	});
	it("does NOT match a genuine article on a news host", () => {
		expect(
			isAggregator(r("https://www.startupdaily.net/2026/01/aglow-funding")),
		).toBe(false);
	});
});
