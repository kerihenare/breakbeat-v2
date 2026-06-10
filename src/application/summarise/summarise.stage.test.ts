import { describe, expect, it, vi } from "vitest";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import type { SummariseInput } from "../../domain/summarise/summarise-input";
import { SUMMARISE_WARNING } from "../../domain/summarise/summarise-warnings";
import type { Summary } from "../../domain/summarise/summary";
import { RunContext } from "../pipeline/run-context";
import type {
	ResultRepository,
	SummariseResultRow,
} from "../search/ports/result-repository.port";
import type { SummarisePort, SummariseResult } from "./ports/summarise.port";
import type { SummaryRepository } from "./ports/summary-repository.port";
import { SummariseStage } from "./summarise.stage";

const SUMMARY: Summary = { summary: "Aglow's coverage is broadly positive." };

const row = (over: Partial<SummariseResultRow> = {}): SummariseResultRow => ({
	sentiment: "positive",
	snippet: "Aglow raised a seed round.",
	takeaway: "Aglow is growing.",
	...over,
});

/** Minimal Resolved Identity exposing companyName — Resolve populates this before Summarise runs. */
const identity = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [],
		socialHandles: [],
	});

/** A RunContext with the Resolved Identity set, exactly as the Search/Filter/Analyze stage tests do. */
function makeCtx(): RunContext {
	const job = Job.create("job-1", nameOnlyAnchor("Aglow"), new Date());
	job.start(new Date());
	const ctx = new RunContext(job);
	ctx.setResolvedIdentity(identity());
	return ctx;
}

/** A fake repo: a settable `included` pool for reads + a one-row-per-Job upserting summaries store. */
function fakeRepos(pool: SummariseResultRow[]) {
	const saved = new Map<string, Summary>();
	const results: Pick<ResultRepository, "findIncludedForSummary"> = {
		findIncludedForSummary: vi.fn(async () => pool),
	};
	const summaries: SummaryRepository = {
		findByJobId: vi.fn(async (jobId: string) => saved.get(jobId) ?? null),
		save: vi.fn(async (jobId: string, summary: Summary) => {
			saved.set(jobId, summary);
		}),
	};
	return { results, saved, summaries };
}

const okPort = (summary: Summary): SummarisePort => ({
	summarise: vi.fn(
		async (): Promise<SummariseResult> => ({ ok: true, summary }),
	),
});
const failPort = (): SummarisePort => ({
	summarise: vi.fn(async (): Promise<SummariseResult> => ({ ok: false })),
});

const make = (port: SummarisePort, r: ReturnType<typeof fakeRepos>) =>
	new SummariseStage(port, r.summaries, r.results as ResultRepository);

describe("SummariseStage", () => {
	it("has name 'summarise'", () => {
		const r = fakeRepos([]);
		expect(make(okPort(SUMMARY), r).name).toBe("summarise");
	});

	it("healthy digest: ≥1 surviving Result → exactly one summarise call → Summary saved once, no Warning", async () => {
		const r = fakeRepos([row(), row({ snippet: "second" })]);
		const port = okPort(SUMMARY);
		const ctx = makeCtx();
		await make(port, r).run(ctx);

		expect(
			(port.summarise as ReturnType<typeof vi.fn>).mock.calls,
		).toHaveLength(1);
		expect(r.summaries.save).toHaveBeenCalledTimes(1);
		expect(r.saved.get(ctx.job.id)).toEqual(SUMMARY);
		expect(ctx.job.warnings).toHaveLength(0);
	});

	it("never per-Result: the port is called at most once regardless of pool size", async () => {
		const r = fakeRepos([row(), row(), row(), row(), row()]);
		const port = okPort(SUMMARY);
		const ctx = makeCtx();
		await make(port, r).run(ctx);
		expect(
			(port.summarise as ReturnType<typeof vi.fn>).mock.calls.length,
		).toBeLessThanOrEqual(1);
	});

	it("the port receives only `included` rows' snippets+Enhancements (Excluded never feed it)", async () => {
		const r = fakeRepos([
			row({ snippet: "keep" }),
			row({ sentiment: null, snippet: "keep too", takeaway: null }),
		]);
		const port = okPort(SUMMARY);
		const ctx = makeCtx();
		await make(port, r).run(ctx);
		const input = (port.summarise as ReturnType<typeof vi.fn>).mock
			.calls[0][0] as SummariseInput;
		expect(input.items.map((i) => i.snippet)).toEqual(["keep", "keep too"]);
		expect(input.items[1]).toEqual({
			sentiment: null,
			snippet: "keep too",
			takeaway: null,
		});
	});

	it("empty case: zero `included` Results → no summarise call, no save, one summarise_empty Warning", async () => {
		const r = fakeRepos([]);
		const port = okPort(SUMMARY);
		const ctx = makeCtx();
		await make(port, r).run(ctx);

		expect(port.summarise).not.toHaveBeenCalled();
		expect(r.summaries.save).not.toHaveBeenCalled();
		expect(ctx.job.warnings.map((w) => w.type)).toEqual([
			SUMMARISE_WARNING.summariseEmpty,
		]);
	});

	it("adapter error: port returns { ok: false } → one summarise_failed Warning, Summary absent, no save", async () => {
		const r = fakeRepos([row()]);
		const ctx = makeCtx();
		await make(failPort(), r).run(ctx);

		expect(r.summaries.save).not.toHaveBeenCalled();
		expect(ctx.job.warnings.map((w) => w.type)).toEqual([
			SUMMARISE_WARNING.summariseFailed,
		]);
	});

	it("Zod-validation failure: the adapter's typed { ok: false } is handled identically (summarise_failed)", async () => {
		// The application cannot tell an adapter error from a schema-validation failure — both are { ok: false }.
		const r = fakeRepos([row()]);
		const ctx = makeCtx();
		await make(failPort(), r).run(ctx);
		expect(ctx.job.warnings.map((w) => w.type)).toEqual([
			SUMMARISE_WARNING.summariseFailed,
		]);
	});

	it("never throws JobFailedError on any shortfall (empty or failed)", async () => {
		const empty = fakeRepos([]);
		const ctx1 = makeCtx();
		await expect(
			make(okPort(SUMMARY), empty).run(ctx1),
		).resolves.toBeUndefined();

		const failed = fakeRepos([row()]);
		const ctx2 = makeCtx();
		await expect(make(failPort(), failed).run(ctx2)).resolves.toBeUndefined();
	});

	it("exactly one Summary per Job: a re-entrant run upserts (the fake enforces one row keyed by jobId)", async () => {
		const r = fakeRepos([row()]);
		const port = okPort(SUMMARY);
		const stage = make(port, r);
		const ctx = makeCtx();
		await stage.run(ctx);
		await stage.run(ctx); // re-entrant
		expect(r.saved.size).toBe(1);
		expect(r.saved.get(ctx.job.id)).toEqual(SUMMARY);
	});
});
