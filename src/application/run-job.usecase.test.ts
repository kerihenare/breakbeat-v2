import { describe, expect, it } from "vitest";
import { disambiguatedAnchor } from "../domain/job/company-anchor";
import { Job } from "../domain/job/job";
import { JobFailedError } from "../domain/job/job-errors";
import { warning } from "../domain/job/warning";
import {
	FakeEventPublisher,
	FakeJobRepository,
	FixedClock,
} from "../testing/fakes";
import type { RunContext } from "./pipeline/run-context";
import type { Stage } from "./pipeline/stage.port";
import { StageRunner } from "./pipeline/stage-runner";
import { JobNotFoundError, RunJobUseCase } from "./run-job.usecase";

function stage(
	name: string,
	run: (ctx: RunContext) => void | Promise<void>,
): Stage {
	return { name, run: async (ctx) => run(ctx) };
}

async function seedPendingJob(
	jobs: FakeJobRepository,
	id = "job-1",
): Promise<string> {
	const job = Job.create(
		id,
		disambiguatedAnchor({ domain: "aglow.example", provenance: "picked" }),
		new Date(),
	);
	await jobs.save(job);
	return id;
}

function makeUseCase(stages: Stage[]) {
	const jobs = new FakeJobRepository();
	const publisher = new FakeEventPublisher();
	const useCase = new RunJobUseCase(
		jobs,
		publisher,
		new FixedClock(),
		new StageRunner(stages),
	);
	return { jobs, publisher, useCase };
}

describe("RunJobUseCase", () => {
	it("loads, starts, drives the empty runner, and completes the Job → done", async () => {
		const { jobs, useCase } = makeUseCase([]);
		const id = await seedPendingJob(jobs);
		await useCase.execute(id);
		expect((await jobs.findById(id))?.state).toBe("done");
	});

	it("publishes a status nudge after start and after the terminal write", async () => {
		const { jobs, publisher, useCase } = makeUseCase([]);
		const id = await seedPendingJob(jobs);
		await useCase.execute(id);
		expect(publisher.published).toEqual([
			{ jobId: id, kind: "status" },
			{ jobId: id, kind: "status" },
		]);
	});

	it("persists the running state before driving the runner", async () => {
		const { jobs, useCase } = makeUseCase([]);
		const id = await seedPendingJob(jobs);
		await useCase.execute(id);
		// pending (seed) → running (start) → done (complete)
		expect(jobs.savedStates).toEqual(["pending", "running", "done"]);
	});

	it("re-delivery of an already-running Job re-runs it to a terminal state (never stuck running)", async () => {
		const { jobs, useCase } = makeUseCase([]);
		// Simulate a worker that started the Job then crashed before completing.
		const job = Job.create(
			"job-redeliver",
			disambiguatedAnchor({ domain: "aglow.example", provenance: "picked" }),
			new Date(),
		);
		job.start(new Date());
		await jobs.save(job);
		expect((await jobs.findById("job-redeliver"))?.state).toBe("running");

		await expect(useCase.execute("job-redeliver")).resolves.toBeUndefined();
		expect((await jobs.findById("job-redeliver"))?.state).toBe("done");
	});

	it("re-delivery of an already-terminal Job is a no-op", async () => {
		const { jobs, publisher, useCase } = makeUseCase([]);
		const job = Job.create(
			"job-done",
			disambiguatedAnchor({ domain: "aglow.example", provenance: "picked" }),
			new Date(),
		);
		job.start(new Date());
		job.complete(new Date());
		await jobs.save(job);

		await useCase.execute("job-done");
		expect((await jobs.findById("job-done"))?.state).toBe("done");
		expect(publisher.published).toHaveLength(0); // no new transitions, no nudges
	});

	it("a warning-recording stage drives done_with_warnings", async () => {
		const { jobs, useCase } = makeUseCase([
			stage("analyze", (ctx) =>
				ctx.recordWarning(warning("classify_failed", "did not run")),
			),
		]);
		const id = await seedPendingJob(jobs);
		await useCase.execute(id);
		const job = await jobs.findById(id);
		expect(job?.state).toBe("done_with_warnings");
		expect(job?.warnings).toHaveLength(1);
	});

	it("a JobFailedError stage drives failed with the reason and never leaves running", async () => {
		const { jobs, useCase } = makeUseCase([
			stage("search", () => {
				throw new JobFailedError("all search queries failed");
			}),
		]);
		const id = await seedPendingJob(jobs);
		await useCase.execute(id);
		const job = await jobs.findById(id);
		expect(job?.state).toBe("failed");
		expect(job?.failureReason).toBe("all search queries failed");
	});

	it("an unexpected stage throw drives failed with the throw recorded", async () => {
		const { jobs, useCase } = makeUseCase([
			stage("resolve", () => {
				throw new Error("connection reset");
			}),
		]);
		const id = await seedPendingJob(jobs);
		await useCase.execute(id);
		const job = await jobs.findById(id);
		expect(job?.state).toBe("failed");
		expect(job?.failureReason).toContain("connection reset");
	});

	it("throws JobNotFoundError when the Job id does not exist (fail fast)", async () => {
		const { useCase } = makeUseCase([]);
		await expect(useCase.execute("missing")).rejects.toBeInstanceOf(
			JobNotFoundError,
		);
	});
});
