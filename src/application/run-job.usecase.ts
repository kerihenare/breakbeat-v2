import { isTerminal } from "../domain/job/job-state";
import { RunContext } from "./pipeline/run-context";
import type { StageRunner } from "./pipeline/stage-runner";
import type { Clock } from "./ports/clock.port";
import type { JobEventPublisher } from "./ports/job-event-publisher.port";
import type { JobRepository } from "./ports/job-repository.port";

/** Raised when the worker is handed a Job id that does not exist. */
export class JobNotFoundError extends Error {
	constructor(jobId: string) {
		super(`Job ${jobId} not found`);
		this.name = "JobNotFoundError";
	}
}

/**
 * Run a Job (worker side): load, start, drive the StageRunner, derive the
 * terminal state, and persist + publish a status nudge after each committed
 * write. The publish-after-write call sites are established here so PRD 7 adds
 * only the subscriber.
 *
 * Re-entrant for BullMQ re-delivery (worker restart / stalled re-claim, ADR
 * 0004): a Job already terminal is a no-op; a Job still `running` is re-run
 * from its claim rather than re-`start`ed (which would throw) — so a Job is
 * never left stuck in `running`.
 */
export class RunJobUseCase {
	constructor(
		private readonly jobs: JobRepository,
		private readonly publisher: JobEventPublisher,
		private readonly clock: Clock,
		private readonly runner: StageRunner,
	) {}

	async execute(jobId: string): Promise<void> {
		const job = await this.jobs.findById(jobId);
		if (!job) {
			// Fail fast: the enqueue contract guarantees the row was persisted
			// before enqueue, so absence is a real fault, not a silent skip.
			throw new JobNotFoundError(jobId);
		}

		if (isTerminal(job.state)) return; // re-delivery of a finished Job — no-op
		if (job.state === "pending") {
			job.start(this.clock.now());
			await this.jobs.save(job);
			await this.publisher.publish({ jobId: job.id, kind: "status" });
		}

		const ctx = new RunContext(job);
		let reason: string | null = null;
		try {
			const outcome = await this.runner.run(ctx);
			if (outcome.kind === "failed") reason = outcome.reason;
		} catch (error) {
			// Defensive: the runner is designed not to throw, but an escaping
			// throw must still drive `failed` — never leave the Job `running`.
			reason = error instanceof Error ? error.message : "unexpected error";
		}

		if (reason === null) {
			job.complete(this.clock.now());
		} else {
			job.fail(reason, this.clock.now());
		}
		await this.jobs.save(job);
		await this.publisher.publish({ jobId: job.id, kind: "status" });
	}
}
