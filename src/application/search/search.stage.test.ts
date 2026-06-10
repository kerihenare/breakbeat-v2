import { describe, expect, it, vi } from "vitest";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { JobFailedError } from "../../domain/job/job-errors";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { SEARCH_WARNING } from "../../domain/search/search-warnings";
import { RunContext } from "../pipeline/run-context";
import type { ResultInsert } from "./ports/result-repository.port";
import type {
	NormalizedHit,
	SearchSourceResult,
	TavilySearchPort,
} from "./ports/tavily-search.port";
import type { WebSearchBackstopPort } from "./ports/web-search-backstop.port";
import { SearchStage } from "./search.stage";
import type { SearchConfig } from "./search-config";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const clock = { now: () => NOW };
const config: SearchConfig = {
	horizonMonths: 36,
	lowYieldThreshold: 10,
	windowMonths: 12,
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

/** A `running` Job so `recordWarning` is legal. */
function runningContext(): RunContext {
	const job = Job.create("job-1", nameOnlyAnchor("Aglow"), NOW);
	job.start(NOW);
	const ctx = new RunContext(job);
	ctx.setResolvedIdentity(identity());
	return ctx;
}

const hits = (n: number, base = "https://site.example/a"): NormalizedHit[] =>
	Array.from({ length: n }, (_, i) => ({
		publishedDate: null,
		relevance: 0.5,
		snippet: `s${i}`,
		title: `t${i}`,
		url: `${base}${i}`,
	}));

const ok = (h: NormalizedHit[]): SearchSourceResult => ({
	failed: false,
	hits: h,
});
const fail = (): SearchSourceResult => ({ failed: true, hits: [] });

/** A fake repo that enforces the (job_id, normalized_url) dedup and returns rows actually inserted. */
function fakeRepo() {
	const seen = new Set<string>();
	const rows: ResultInsert[] = [];
	return {
		// Filter/analyze methods the SearchStage never calls — present so the fake
		// satisfies the (widened) ResultRepository port.
		applyFullTextOutcome: vi.fn(async () => {}),
		findIncluded: vi.fn(async () => []),
		findIncludedForSummary: vi.fn(async () => []),
		insertIncluded: vi.fn(
			async (_jobId: string, inserts: readonly ResultInsert[]) => {
				let inserted = 0;
				for (const r of inserts) {
					if (seen.has(r.normalizedUrl)) continue;
					seen.add(r.normalizedUrl);
					rows.push(r);
					inserted += 1;
				}
				return inserted;
			},
		),
		recordExclusion: vi.fn(async () => {}),
		rows,
		setExtractedContent: vi.fn(async () => {}),
		setInterimMatchScore: vi.fn(async () => {}),
		setProvisionalContentType: vi.fn(async () => {}),
	};
}

type Fakes = {
	tavily: TavilySearchPort;
	backstop: WebSearchBackstopPort;
	repo: ReturnType<typeof fakeRepo>;
};
const make = (f: Fakes) =>
	new SearchStage(f.tavily, f.backstop, f.repo, config, clock);

describe("SearchStage", () => {
	it("has name 'search'", () => {
		const f = {
			backstop: { search: vi.fn(async () => ok([])) },
			repo: fakeRepo(),
			tavily: { search: vi.fn(async () => ok([])) },
		};
		expect(make(f).name).toBe("search");
	});

	it("healthy yield: broad set meets the threshold → no escalation, no backstop, no warning", async () => {
		const f = {
			backstop: { search: vi.fn(async () => ok(hits(5))) },
			repo: fakeRepo(),
			tavily: { search: vi.fn(async () => ok(hits(12))) }, // 12 distinct ≥ threshold 10
		};
		const ctx = runningContext();
		await make(f).run(ctx);

		// Only broad queries ran; backstop never called; angle/type-targeted never sent.
		expect(f.backstop.search).not.toHaveBeenCalled();
		expect(ctx.job.warnings).toHaveLength(0);
		// every Tavily call this run carried a broad query
		for (const call of (f.tavily.search as ReturnType<typeof vi.fn>).mock
			.calls) {
			expect(call[0].kind).toBe("broad");
		}
	});

	it("thin yield: broad set below threshold → escalates angle + type-targeted + backstop", async () => {
		const f = {
			backstop: {
				search: vi.fn(async () => ok(hits(3, "https://rescue.example/r"))),
			},
			repo: fakeRepo(),
			tavily: { search: vi.fn(async () => ok(hits(2))) }, // 2 distinct per query, dedups thin
		};
		const ctx = runningContext();
		await make(f).run(ctx);

		expect(f.backstop.search).toHaveBeenCalledWith("Aglow");
		const kinds = new Set(
			(f.tavily.search as ReturnType<typeof vi.fn>).mock.calls.map(
				(c) => c[0].kind,
			),
		);
		expect(kinds.has("broad")).toBe(true);
		expect(kinds.has("angle")).toBe(true);
		expect(kinds.has("type_targeted")).toBe(true);
	});

	it("provisional score: Tavily rows get scaled relevance, backstop rows get the floor", async () => {
		const f = {
			backstop: {
				search: vi.fn(async () =>
					ok([
						{
							publishedDate: null,
							relevance: null,
							snippet: "s",
							title: "b",
							url: "https://b.example/1",
						},
					]),
				),
			},
			repo: fakeRepo(),
			tavily: {
				search: vi.fn(async () =>
					ok([
						{
							publishedDate: null,
							relevance: 0.9,
							snippet: "s",
							title: "t",
							url: "https://t.example/1",
						},
					]),
				),
			},
		};
		const ctx = runningContext();
		await make(f).run(ctx); // 1 distinct broad < 10 → escalates → backstop runs

		const tavilyRow = f.repo.rows.find((r) => r.source === "tavily");
		const backstopRow = f.repo.rows.find(
			(r) => r.source === "web_search_backstop",
		);
		expect(tavilyRow?.matchScore).toBe(90);
		expect(backstopRow?.matchScore).toBe(0);
		expect(f.repo.rows.every((r) => !("verificationStatus" in r))).toBe(true);
	});

	it("partial failure: some queries fail but others succeed → one warning, Results still returned", async () => {
		let call = 0;
		const f = {
			backstop: { search: vi.fn(async () => ok([])) },
			repo: fakeRepo(),
			tavily: {
				search: vi.fn(async () => (call++ % 2 === 0 ? ok(hits(15)) : fail())),
			},
		};
		const ctx = runningContext();
		await make(f).run(ctx);

		expect(ctx.job.warnings.map((w) => w.type)).toContain(
			SEARCH_WARNING.queriesPartiallyFailed,
		);
		expect(f.repo.rows.length).toBeGreaterThan(0);
	});

	it("backstop failure on escalation: Tavily produced → backstop_failed warning, no Job failure", async () => {
		const f = {
			backstop: { search: vi.fn(async () => fail()) },
			repo: fakeRepo(),
			tavily: { search: vi.fn(async () => ok(hits(2))) }, // thin → escalate
		};
		const ctx = runningContext();
		await make(f).run(ctx);
		expect(ctx.job.warnings.map((w) => w.type)).toContain(
			SEARCH_WARNING.backstopFailed,
		);
	});

	it("total failure: every call across every source fails → throws JobFailedError", async () => {
		const f = {
			backstop: { search: vi.fn(async () => fail()) },
			repo: fakeRepo(),
			tavily: { search: vi.fn(async () => fail()) },
		};
		const ctx = runningContext();
		await expect(make(f).run(ctx)).rejects.toBeInstanceOf(JobFailedError);
	});

	it("insert-time dedup: a URL returned by two sources is inserted once and counted once", async () => {
		const dupe = [
			{
				publishedDate: null,
				relevance: 0.5,
				snippet: "s",
				title: "t",
				url: "https://dupe.example/x",
			},
		];
		const f = {
			backstop: { search: vi.fn(async () => ok(dupe)) }, // same URL
			repo: fakeRepo(),
			tavily: { search: vi.fn(async () => ok(dupe)) }, // 1 distinct broad < 10 → escalate
		};
		const ctx = runningContext();
		await make(f).run(ctx);
		expect(
			f.repo.rows.filter((r) => r.normalizedUrl === "dupe.example/x"),
		).toHaveLength(1);
	});
});
