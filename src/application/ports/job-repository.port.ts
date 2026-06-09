import type { Job } from "../../domain/job/job";

/** Loads and saves Jobs (with their Warnings). Implemented by the Drizzle adapter. */
export interface JobRepository {
	save(job: Job): Promise<void>;
	findById(id: string): Promise<Job | null>;
}

export const JOB_REPOSITORY = Symbol("JobRepository");
