import { describe, expect, it, vi } from "vitest";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import type { FilterConfig } from "../../domain/filter/filter-config";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { RunContext } from "../pipeline/run-context";
import type {
	FilterResult,
	ResultRepository,
} from "../search/ports/result-repository.port";
import { FilterStage } from "./filter.stage";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const clock = { now: () => NOW };
const config: FilterConfig = {
	collapseWindowDays: 14,
	horizonMonths: 36,
	minClusterDomains: 2,
	minDistinctiveTokens: 5,
};

const aglow = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
		socialHandles: [
			{
				handle: "getaglow",
				platform: "linkedin",
				url: "https://www.linkedin.com/company/getaglow",
			},
			{
				handle: "aglow_app",
				platform: "instagram",
				url: "https://instagram.com/aglow_app",
			},
		],
	});

function fakeRepo(pool: FilterResult[]) {
	const excluded = new Map<string, ExclusionCode>();
	return {
		applyFullTextOutcome: vi.fn(async () => {}),
		excluded,
		findIncluded: vi.fn(async () => pool.filter((r) => !excluded.has(r.id))),
		findIncludedForSummary: vi.fn(async () => []),
		insertIncluded: vi.fn(async () => 0),
		recordExclusion: vi.fn(async (id: string, code: ExclusionCode) => {
			if (!excluded.has(id)) excluded.set(id, code);
		}),
		setExtractedContent: vi.fn(async () => {}),
		setInterimMatchScore: vi.fn(async () => {}),
		setProvisionalContentType: vi.fn(async () => {}),
	} satisfies ResultRepository & { excluded: Map<string, ExclusionCode> };
}

function runningContext(): RunContext {
	const job = Job.create("job-1", nameOnlyAnchor("Aglow"), NOW);
	job.start(NOW);
	const ctx = new RunContext(job);
	ctx.setResolvedIdentity(aglow());
	return ctx;
}

const COVERAGE_TITLE =
	"Aglow raises $5M seed round to expand its beauty membership platform";

const POOL: FilterResult[] = [
	// own_channel
	{
		id: "site",
		publishedDate: "2026-02-01",
		snippet: "",
		title: "About Aglow",
		url: "https://getaglow.co/about",
	},
	{
		id: "li",
		publishedDate: null,
		snippet: "",
		title: "Aglow on LinkedIn",
		url: "https://www.linkedin.com/company/getaglow",
	},
	{
		id: "ig",
		publishedDate: null,
		snippet: "",
		title: "Aglow (@aglow_app)",
		url: "https://instagram.com/aglow_app",
	},
	// aggregator / ecommerce_review
	{
		id: "agg",
		publishedDate: "2026-03-01",
		snippet: "",
		title: "Aglow - Google News",
		url: "https://news.google.com/articles/aglow",
	},
	{
		id: "g2",
		publishedDate: "2026-03-02",
		snippet: "",
		title: "Aglow Reviews",
		url: "https://www.g2.com/products/aglow/reviews",
	},
	// genuine third-party coverage (must survive) — collapsible re-print pair across 2 domains
	{
		id: "bna",
		publishedDate: "2026-01-02",
		snippet: "Aglow announced...",
		title: `${COVERAGE_TITLE} — Business News Australia`,
		url: "https://businessnews.com.au/article/aglow-seed",
	},
	{
		id: "sd",
		publishedDate: "2026-01-05",
		snippet: "Aglow announced...",
		title: `${COVERAGE_TITLE} | Startup Daily`,
		url: "https://startupdaily.net/2026/01/aglow-seed",
	},
	// different-entity same-name (Filter must NOT touch it — that is Verify's off_topic)
	{
		id: "ministry",
		publishedDate: "2026-02-10",
		snippet: "prayer",
		title: "Aglow International womens ministry annual conference gathering",
		url: "https://aglow.org/events/conference",
	},
];

describe("Filter — Aglow precision fixture", () => {
	it("Excludes own-channel/aggregator/ecommerce mass, collapses the re-print, preserves real coverage and leaves different-entity rows to Verify", async () => {
		const repo = fakeRepo([...POOL]);
		const ctx = runningContext();
		await new FilterStage(repo, config, clock).run(ctx);

		// own_channel
		expect(repo.excluded.get("site")).toBe("own_channel");
		expect(repo.excluded.get("li")).toBe("own_channel");
		expect(repo.excluded.get("ig")).toBe("own_channel");
		// aggregator + ecommerce_review
		expect(repo.excluded.get("agg")).toBe("aggregator");
		expect(repo.excluded.get("g2")).toBe("ecommerce_review");
		// Collapse: earliest (bna) wins, later re-print (sd) Excluded duplicate
		expect(repo.excluded.has("bna")).toBe(false);
		expect(repo.excluded.get("sd")).toBe("duplicate");
		// different-entity same-name row is NOT Filter's job — it stays included
		expect(repo.excluded.has("ministry")).toBe(false);
	});
});
