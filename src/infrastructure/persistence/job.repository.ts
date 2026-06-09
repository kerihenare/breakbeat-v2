import { count, eq } from "drizzle-orm";
import type { JobRepository } from "../../application/ports/job-repository.port";
import { Job } from "../../domain/job/job";
import { warning } from "../../domain/job/warning";
import type { Database } from "./database";
import { anchorColumns, rowToAnchor } from "./job.mapper";
import { jobs, warnings } from "./schema";

/**
 * Drizzle adapter for the JobRepository port. `save` upserts the `jobs` row and
 * synchronises (append-only) `warnings` in one transaction; the anchor columns
 * are written on insert and never updated. A re-run is a brand-new Job — the
 * repository never mutates a prior Job's rows (immutable history).
 */
export class DrizzleJobRepository implements JobRepository {
	constructor(private readonly db: Database) {}

	async save(job: Job): Promise<void> {
		const s = job.toSnapshot();
		await this.db.transaction(async (tx) => {
			await tx
				.insert(jobs)
				.values({
					id: s.id,
					...anchorColumns(s.anchor),
					createdAt: s.createdAt,
					failureReason: s.failureReason,
					startedAt: s.startedAt,
					state: s.state,
					terminalAt: s.terminalAt,
				})
				// Mutable columns only — the frozen anchor is never updated.
				.onConflictDoUpdate({
					set: {
						failureReason: s.failureReason,
						startedAt: s.startedAt,
						state: s.state,
						terminalAt: s.terminalAt,
					},
					target: jobs.id,
				});

			// Warnings are append-only: insert only those beyond what's persisted.
			const [{ persisted }] = await tx
				.select({ persisted: count() })
				.from(warnings)
				.where(eq(warnings.jobId, s.id));
			const toAdd = s.warnings.slice(persisted);
			if (toAdd.length > 0) {
				await tx.insert(warnings).values(
					toAdd.map((w) => ({
						jobId: s.id,
						message: w.message,
						type: w.type,
					})),
				);
			}
		});
	}

	async findById(id: string): Promise<Job | null> {
		const [row] = await this.db
			.select()
			.from(jobs)
			.where(eq(jobs.id, id))
			.limit(1);
		if (!row) return null;
		const warningRows = await this.db
			.select()
			.from(warnings)
			.where(eq(warnings.jobId, id))
			.orderBy(warnings.createdAt, warnings.id);
		return Job.fromPersistence({
			anchor: rowToAnchor(row),
			createdAt: row.createdAt,
			failureReason: row.failureReason,
			id: row.id,
			startedAt: row.startedAt,
			state: row.state,
			terminalAt: row.terminalAt,
			warnings: warningRows.map((w) => warning(w.type, w.message)),
		});
	}
}
