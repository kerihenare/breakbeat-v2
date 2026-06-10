import { describe, expect, it, vi } from "vitest";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import type { FilterConfig } from "../../domain/filter/filter-config";
import { FILTER_WARNING } from "../../domain/filter/filter-warnings";
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

const identity = (
	over: Partial<Parameters<typeof ResolvedIdentity.assemble>[0]> = {},
) =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
		socialHandles: [],
		...over,
	});

/** A running RunContext (so `recordWarning` is legal), optionally with a ResolvedIdentity. */
function runningContext(withIdentity = true): RunContext {
	const job = Job.create("job-1", nameOnlyAnchor("Aglow"), NOW);
	job.start(NOW);
	const ctx = new RunContext(job);
	if (withIdentity) ctx.setResolvedIdentity(identity());
	return ctx;
}

/** A fake repo over a fixed pool: records exclusions, honours the included-only / idempotent contract. */
function fakeRepo(pool: FilterResult[]) {
	const excluded = new Map<
		string,
		{ code: ExclusionCode; detail: string | null }
	>();
	return {
		applyFullTextOutcome: vi.fn(async () => {}),
		excluded,
		findIncluded: vi.fn(async () => pool.filter((r) => !excluded.has(r.id))),
		findIncludedForSummary: vi.fn(async () => []),
		insertIncluded: vi.fn(async () => 0),
		recordExclusion: vi.fn(
			async (id: string, code: ExclusionCode, detail: string | null) => {
				if (!excluded.has(id)) excluded.set(id, { code, detail }); // included-only / idempotent
			},
		),
		setExtractedContent: vi.fn(async () => {}),
		setInterimMatchScore: vi.fn(async () => {}),
		setProvisionalContentType: vi.fn(async () => {}),
	} satisfies ResultRepository & {
		excluded: Map<string, { code: ExclusionCode; detail: string | null }>;
	};
}

const result = (over: Partial<FilterResult>): FilterResult => ({
	id: "r",
	publishedDate: "2026-01-01",
	snippet: "s",
	title: "t",
	url: "https://news.site/a",
	...over,
});

const TITLE =
	"Aglow raises $5M seed round to expand its beauty membership platform";

describe("FilterStage", () => {
	it("has name 'filter'", () => {
		expect(new FilterStage(fakeRepo([]), config, clock).name).toBe("filter");
	});

	it("heuristic pass excludes the expected rows with the expected codes", async () => {
		const repo = fakeRepo([
			result({ id: "own", url: "https://getaglow.co/about" }),
			result({ id: "shop", url: "https://www.amazon.com/dp/B01" }),
			result({ id: "agg", url: "https://news.google.com/articles/x" }),
			result({
				id: "old",
				publishedDate: "2021-01-01",
				url: "https://news.site/old",
			}),
			result({
				id: "keep",
				title: "Unique distinct headline alpha beta gamma delta epsilon",
				url: "https://startupdaily.net/aglow",
			}),
		]);
		const ctx = runningContext();
		await new FilterStage(repo, config, clock).run(ctx);

		expect(repo.excluded.get("own")?.code).toBe("own_channel");
		expect(repo.excluded.get("shop")?.code).toBe("ecommerce_review");
		expect(repo.excluded.get("agg")?.code).toBe("aggregator");
		expect(repo.excluded.get("old")?.code).toBe("out_of_window");
		expect(repo.excluded.has("keep")).toBe(false);
	});

	it("Collapse pass runs over survivors only and points losers at the winner", async () => {
		const repo = fakeRepo([
			result({
				id: "early",
				publishedDate: "2026-01-01",
				title: TITLE,
				url: "https://businessnews.com.au/a",
			}),
			result({
				id: "late",
				publishedDate: "2026-01-04",
				title: TITLE,
				url: "https://startupdaily.net/a",
			}),
		]);
		const ctx = runningContext();
		await new FilterStage(repo, config, clock).run(ctx);

		expect(repo.excluded.get("late")).toEqual({
			code: "duplicate",
			detail: "of:early",
		});
		expect(repo.excluded.has("early")).toBe(false);
	});

	it("records exactly one degraded-own-channel Warning when no own domains are resolved", async () => {
		const repo = fakeRepo([
			result({ id: "agg", url: "https://news.google.com/x" }),
		]);
		const job = Job.create("job-1", nameOnlyAnchor("Aglow"), NOW);
		job.start(NOW);
		const ctx = new RunContext(job);
		ctx.setResolvedIdentity(identity({ ownDomains: [] }));
		await new FilterStage(repo, config, clock).run(ctx);

		expect(ctx.job.warnings.map((w) => w.type)).toEqual([
			FILTER_WARNING.ownChannelDegraded,
		]);
		expect(repo.excluded.get("agg")?.code).toBe("aggregator"); // independent rules still run
	});

	it("never throws JobFailedError (an empty population is a valid outcome)", async () => {
		const repo = fakeRepo([]);
		const ctx = runningContext();
		await expect(
			new FilterStage(repo, config, clock).run(ctx),
		).resolves.toBeUndefined();
	});

	it("throws a plain Error when resolvedIdentity is missing (programming/ordering fault)", async () => {
		const repo = fakeRepo([]);
		const ctx = runningContext(false); // resolvedIdentity not set
		await expect(new FilterStage(repo, config, clock).run(ctx)).rejects.toThrow(
			/ResolvedIdentity/,
		);
	});

	it("is idempotent: a second run records no new exclusions and rewrites no code", async () => {
		const repo = fakeRepo([
			result({ id: "own", url: "https://getaglow.co/x" }),
		]);
		const ctx = runningContext();
		const stage = new FilterStage(repo, config, clock);
		await stage.run(ctx);
		const callsAfterFirst = repo.recordExclusion.mock.calls.length;
		await stage.run(ctx);
		expect(repo.excluded.get("own")?.code).toBe("own_channel");
		expect(repo.recordExclusion.mock.calls.length).toBe(callsAfterFirst); // no new exclusion (pool is smaller)
	});
});
