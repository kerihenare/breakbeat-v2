import { Job } from "../domain/job/job";
import type { Clock } from "./ports/clock.port";
import type { IdGenerator } from "./ports/id-generator.port";
import type { JobQueue } from "./ports/job-queue.port";
import type { JobRepository } from "./ports/job-repository.port";
import { submitJobInputSchema, toCompanyAnchor } from "./submit-job.input";

/**
 * Submit a Job (web side): validate input, freeze the anchor, persist a
 * `pending` Job, and enqueue exactly one unit of work. A plain class with
 * constructor injection of ports — no framework here (Hexagonal).
 */
export class SubmitJobUseCase {
	constructor(
		private readonly jobs: JobRepository,
		private readonly queue: JobQueue,
		private readonly clock: Clock,
		private readonly ids: IdGenerator,
	) {}

	async execute(rawInput: unknown): Promise<string> {
		const input = submitJobInputSchema.parse(rawInput);
		const anchor = toCompanyAnchor(input);
		const job = Job.create(this.ids.uuidv7(), anchor, this.clock.now());
		await this.jobs.save(job);
		try {
			await this.queue.enqueue({ jobId: job.id });
		} catch (enqueueError) {
			// Enqueue failed (e.g. Redis down) after the pending row was written.
			// No worker will ever pick it up, so compensate by removing the orphan.
			// Compensation is best-effort: the enqueue failure is the real fault to
			// surface, so a failed delete must not mask it.
			await this.jobs.delete(job.id).catch(() => {});
			throw enqueueError;
		}
		return job.id;
	}
}
