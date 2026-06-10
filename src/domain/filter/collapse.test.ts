import { describe, expect, it } from "vitest";
import { type CollapseInput, collapse } from "./collapse";
import type { FilterConfig } from "./filter-config";

const config: FilterConfig = {
	collapseWindowDays: 14,
	horizonMonths: 36,
	minClusterDomains: 2,
	minDistinctiveTokens: 5,
};
const TITLE =
	"Aglow raises $5M seed round to expand beauty membership platform";

const input = (over: Partial<CollapseInput>): CollapseInput => ({
	id: "x",
	publishedDate: "2026-01-02",
	sourceDomain: "site.com",
	title: TITLE,
	...over,
});

describe("collapse", () => {
	it("collapses a distinctive title across >=2 domains within 14 days to the earliest winner", () => {
		const losers = collapse(
			[
				input({
					id: "early",
					publishedDate: "2026-01-01",
					sourceDomain: "businessnews.com.au",
				}),
				input({
					id: "late",
					publishedDate: "2026-01-05",
					sourceDomain: "startupdaily.net",
				}),
			],
			"Aglow",
			config,
		);
		expect(losers).toEqual([{ loserId: "late", winnerId: "early" }]);
	});

	it("leaves same-title copies on a single domain as singletons", () => {
		const losers = collapse(
			[
				input({
					id: "a",
					publishedDate: "2026-01-01",
					sourceDomain: "site.com",
				}),
				input({
					id: "b",
					publishedDate: "2026-01-03",
					sourceDomain: "site.com",
				}),
			],
			"Aglow",
			config,
		);
		expect(losers).toEqual([]);
	});

	it("does not cluster a copy outside the 14-day window (anchored to earliest)", () => {
		const losers = collapse(
			[
				input({ id: "a", publishedDate: "2026-01-01", sourceDomain: "d1.com" }),
				input({ id: "b", publishedDate: "2026-02-01", sourceDomain: "d2.com" }), // >14 days
			],
			"Aglow",
			config,
		);
		expect(losers).toEqual([]); // two separate single-member clusters
	});

	it("never anchors a cluster on a generic/non-distinctive title", () => {
		const losers = collapse(
			[
				{
					id: "a",
					publishedDate: "2026-01-01",
					sourceDomain: "d1.com",
					title: "Funding Announcement",
				},
				{
					id: "b",
					publishedDate: "2026-01-02",
					sourceDomain: "d2.com",
					title: "Funding Announcement",
				},
			],
			"Aglow",
			config,
		);
		expect(losers).toEqual([]);
	});

	it("joins an undated copy only under a single-cluster key", () => {
		const single = collapse(
			[
				input({
					id: "early",
					publishedDate: "2026-01-01",
					sourceDomain: "d1.com",
				}),
				input({
					id: "mid",
					publishedDate: "2026-01-03",
					sourceDomain: "d2.com",
				}),
				input({ id: "undated", publishedDate: null, sourceDomain: "d3.com" }),
			],
			"Aglow",
			config,
		);
		expect(single.map((l) => l.loserId).sort()).toEqual(["mid", "undated"]);
		expect(single.every((l) => l.winnerId === "early")).toBe(true);
	});

	it("leaves an undated copy included under a multi-cluster key", () => {
		const multi = collapse(
			[
				input({ id: "a", publishedDate: "2026-01-01", sourceDomain: "d1.com" }),
				input({ id: "b", publishedDate: "2026-01-02", sourceDomain: "d2.com" }),
				input({ id: "c", publishedDate: "2026-03-01", sourceDomain: "d3.com" }), // separate cluster (>14d)
				input({
					id: "d4.com",
					publishedDate: "2026-03-03",
					sourceDomain: "d4.com",
				}),
				input({ id: "undated", publishedDate: null, sourceDomain: "d5.com" }),
			],
			"Aglow",
			config,
		);
		expect(multi.find((l) => l.loserId === "undated")).toBeUndefined();
	});
});
