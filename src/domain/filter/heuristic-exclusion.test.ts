import { describe, expect, it } from "vitest";
import { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterConfig } from "./filter-config";
import type { FilterResult } from "./filter-result";
import { heuristicExclusion } from "./heuristic-exclusion";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const config: FilterConfig = {
	collapseWindowDays: 14,
	horizonMonths: 36,
	minClusterDomains: 2,
	minDistinctiveTokens: 5,
};

const identity = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
		socialHandles: [],
	});

const r = (over: Partial<FilterResult>): FilterResult => ({
	id: "r",
	publishedDate: null,
	snippet: "s",
	title: "t",
	url: "https://x.example/a",
	...over,
});

describe("heuristicExclusion", () => {
	it("returns the matching code per rule", () => {
		expect(
			heuristicExclusion(
				r({ url: "https://getaglow.co/about" }),
				identity(),
				NOW,
				config,
			),
		).toBe("own_channel");
		expect(
			heuristicExclusion(
				r({ url: "https://www.amazon.com/dp/B01" }),
				identity(),
				NOW,
				config,
			),
		).toBe("ecommerce_review");
		expect(
			heuristicExclusion(
				r({ url: "https://news.google.com/articles/x" }),
				identity(),
				NOW,
				config,
			),
		).toBe("aggregator");
		expect(
			heuristicExclusion(
				r({ publishedDate: "2021-01-01", url: "https://news.site/a" }),
				identity(),
				NOW,
				config,
			),
		).toBe("out_of_window");
	});

	it("returns null when no rule matches", () => {
		expect(
			heuristicExclusion(
				r({
					publishedDate: "2026-01-01",
					url: "https://startupdaily.net/aglow",
				}),
				identity(),
				NOW,
				config,
			),
		).toBeNull();
	});

	it("applies the fixed priority order (own_channel beats the rest)", () => {
		// An own-domain product page that is also old → own_channel wins (most specific surface first).
		const multi = r({
			publishedDate: "2020-01-01",
			url: "https://getaglow.co/product/kit",
		});
		expect(heuristicExclusion(multi, identity(), NOW, config)).toBe(
			"own_channel",
		);
	});
});
