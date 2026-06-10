import { eq } from "drizzle-orm";
import type { SummaryRepository } from "../../application/summarise/ports/summary-repository.port";
import type { Summary } from "../../domain/summarise/summary";
import type { Database } from "./database";
import { summaries } from "./schema";

/**
 * Drizzle adapter for the SummaryRepository port. `save` upserts the Job's single
 * Summary row; the `job_id` PK conflict target enforces one-per-Job and makes a
 * re-entrant stage run idempotent (a re-read pool re-produces, save overwrites).
 * `findByJobId` maps a missing row to `null` — the degraded/absent reading PRD 7
 * renders gracefully as "no digest". Only the Zod-validated digest string is
 * stored (anti-echo). A re-run is a new Job id with its own row.
 */
export class SummaryDrizzleRepository implements SummaryRepository {
	constructor(private readonly db: Database) {}

	async save(jobId: string, summary: Summary): Promise<void> {
		await this.db
			.insert(summaries)
			.values({ jobId, summary: summary.summary })
			.onConflictDoUpdate({
				set: { summary: summary.summary },
				target: summaries.jobId,
			});
	}

	async findByJobId(jobId: string): Promise<Summary | null> {
		const rows = await this.db
			.select({ summary: summaries.summary })
			.from(summaries)
			.where(eq(summaries.jobId, jobId))
			.limit(1);
		const row = rows[0];
		return row ? { summary: row.summary } : null;
	}
}
