import type { Summary } from "../../../domain/summarise/summary";

/** The one-row-per-Job Summary store. */
export interface SummaryRepository {
	/** Upserts the Job's single Summary row (job_id PK conflict → update). Idempotent / re-entrant. */
	save(jobId: string, summary: Summary): Promise<void>;
	/** PRD 7's per-Job read model. `null` = absent/degraded — the Result page renders it as "no digest". */
	findByJobId(jobId: string): Promise<Summary | null>;
}

export const SUMMARY_REPOSITORY = Symbol("SummaryRepository");
