import type { Job } from "../../domain/job/job";

/** Loads and saves Jobs (with their Warnings). Implemented by the Drizzle adapter. */
export interface JobRepository {
	save(job: Job): Promise<void>;
	findById(id: string): Promise<Job | null>;
	/**
	 * Remove a Job by id (with its children, via FK cascade). Used to compensate
	 * a never-started `pending` Job when submit-time enqueue fails — the row would
	 * otherwise be orphaned forever (no worker will ever pick it up). A no-op if
	 * the id is absent.
	 */
	delete(id: string): Promise<void>;
}

export const JOB_REPOSITORY = Symbol("JobRepository");
