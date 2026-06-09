import { describe, expect, it } from "vitest";
import { disambiguatedAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { JobFailedError } from "../../domain/job/job-errors";
import { warning } from "../../domain/job/warning";
import { RunContext } from "./run-context";
import type { Stage } from "./stage.port";
import { StageRunner } from "./stage-runner";

function runningContext(): RunContext {
	const job = Job.create(
		"job-1",
		disambiguatedAnchor({ domain: "aglow.example", provenance: "picked" }),
		new Date(),
	);
	job.start(new Date());
	return new RunContext(job);
}

/** A stage built from an inline behaviour, for driving the runner. */
function stage(
	name: string,
	run: (ctx: RunContext) => Promise<void> | void,
): Stage {
	return { name, run: async (ctx) => run(ctx) };
}

describe("StageRunner — the warn-vs-fail mechanism", () => {
	it("empty stage list → completed (the tracer-bullet path)", async () => {
		const ctx = runningContext();
		const outcome = await new StageRunner([]).run(ctx);
		expect(outcome).toEqual({ kind: "completed" });
		expect(ctx.job.warnings).toHaveLength(0);
	});

	it("runs stages in registered order, threading one shared context", async () => {
		const order: string[] = [];
		const ctx = runningContext();
		const runner = new StageRunner([
			stage("resolve", (c) => {
				order.push("resolve");
				expect(c).toBe(ctx);
			}),
			stage("search", () => {
				order.push("search");
			}),
		]);
		const outcome = await runner.run(ctx);
		expect(outcome.kind).toBe("completed");
		expect(order).toEqual(["resolve", "search"]);
	});

	it("a recoverable-shortfall stage produces a Warning and still completes", async () => {
		const ctx = runningContext();
		const outcome = await new StageRunner([
			stage("search", (c) =>
				c.recordWarning(warning("queries_partial", "2 of 5 queries failed")),
			),
		]).run(ctx);
		expect(outcome.kind).toBe("completed");
		expect(ctx.job.warnings).toHaveLength(1);
		// Completing such a Job yields done_with_warnings (proven via the aggregate).
		ctx.job.complete(new Date());
		expect(ctx.job.state).toBe("done_with_warnings");
	});

	it("accumulates warnings across stages and later stages observe them", async () => {
		const ctx = runningContext();
		await new StageRunner([
			stage("a", (c) => c.recordWarning(warning("a", "first"))),
			stage("b", (c) => {
				expect(c.job.warnings).toHaveLength(1);
				c.recordWarning(warning("b", "second"));
			}),
		]).run(ctx);
		expect(ctx.job.warnings.map((w) => w.type)).toEqual(["a", "b"]);
	});

	it("a 'nothing to show' stage (throws JobFailedError) fails with that reason and stops", async () => {
		const ctx = runningContext();
		const reached: string[] = [];
		const outcome = await new StageRunner([
			stage("search", () => {
				throw new JobFailedError("all search queries failed");
			}),
			stage("filter", () => {
				reached.push("filter");
			}),
		]).run(ctx);
		expect(outcome).toEqual({
			kind: "failed",
			reason: "all search queries failed",
		});
		expect(reached).toEqual([]); // downstream stage never runs
	});

	it("an unexpected throw fails the Job and records the throw against the stage", async () => {
		const ctx = runningContext();
		const outcome = await new StageRunner([
			stage("resolve", () => {
				throw new Error("connection reset");
			}),
		]).run(ctx);
		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("resolve");
			expect(outcome.reason).toContain("connection reset");
		}
	});

	it("a total non-essential stage failure handled as a Warning never fails the Job (Classify-shaped)", async () => {
		const ctx = runningContext();
		// Classify totally fails internally but converts it to a Warning and returns.
		const outcome = await new StageRunner([
			stage("analyze", (c) =>
				c.recordWarning(
					warning("classify_failed", "classification did not run"),
				),
			),
		]).run(ctx);
		expect(outcome.kind).toBe("completed");
		expect(ctx.job.warnings).toHaveLength(1);
	});
});

describe("RunContext resolvedIdentity slot (reserved for PRD 2)", () => {
	it("is undefined until set, then readable, and set-once", () => {
		const ctx = runningContext();
		expect(ctx.resolvedIdentity).toBeUndefined();
		ctx.setResolvedIdentity({ companyName: "Aglow" });
		expect(ctx.resolvedIdentity).toEqual({ companyName: "Aglow" });
		expect(() => ctx.setResolvedIdentity({ companyName: "Other" })).toThrow();
	});
});
