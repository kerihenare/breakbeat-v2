import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type {
	ContentTypeCount,
	JobListItem,
	JobsListReadModel,
	Paged,
	ResultReadRow,
	ResultsReadModel,
} from "../../application/ports/read-models.port";
import type { Database } from "./database";
import { jobs, results } from "./schema";

/** Columns the UI reads for a Result row (a subset — never extracted content). */
const resultColumns = {
	contentType: results.contentType,
	exclusionCode: results.exclusionCode,
	exclusionDetail: results.exclusionDetail,
	id: results.id,
	matchScore: results.matchScore,
	publishedDate: results.publishedDate,
	sentiment: results.sentiment,
	sourceDomain: results.sourceDomain,
	status: results.status,
	title: results.title,
	url: results.url,
	verificationStatus: results.verificationStatus,
};

export class DrizzleJobsListReadModel implements JobsListReadModel {
	constructor(private readonly db: Database) {}

	async list(page: number, pageSize: number): Promise<Paged<JobListItem>> {
		const offset = Math.max(0, (page - 1) * pageSize);
		const rows = await this.db
			.select()
			.from(jobs)
			.orderBy(desc(jobs.createdAt))
			.limit(pageSize)
			.offset(offset);
		const [{ total }] = await this.db.select({ total: count() }).from(jobs);

		const ids = rows.map((r) => r.id);
		const counts = ids.length
			? await this.db
					.select({ c: count(), jobId: results.jobId })
					.from(results)
					.where(
						and(inArray(results.jobId, ids), eq(results.status, "included")),
					)
					.groupBy(results.jobId)
			: [];
		const countByJob = new Map(counts.map((c) => [c.jobId, Number(c.c)]));

		const items: JobListItem[] = rows.map((r) => ({
			anchorLabel:
				r.anchorName ??
				r.anchorDomain ??
				r.anchorBrandId ??
				"(unknown company)",
			createdAt: r.createdAt,
			id: r.id,
			includedCount: countByJob.get(r.id) ?? 0,
			state: r.state,
		}));
		return { items, total: Number(total) };
	}
}

export class DrizzleResultsReadModel implements ResultsReadModel {
	constructor(private readonly db: Database) {}

	async includedPage(
		jobId: string,
		page: number,
		pageSize: number,
	): Promise<Paged<ResultReadRow>> {
		const offset = Math.max(0, (page - 1) * pageSize);
		const items = await this.db
			.select(resultColumns)
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "included")))
			// Match Score desc, NULLs (Unverified) last; stable by insertion time.
			.orderBy(
				sql`${results.matchScore} desc nulls last`,
				desc(results.createdAt),
			)
			.limit(pageSize)
			.offset(offset);
		const [{ total }] = await this.db
			.select({ total: count() })
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "included")));
		return { items, total: Number(total) };
	}

	async excluded(jobId: string): Promise<readonly ResultReadRow[]> {
		return this.db
			.select(resultColumns)
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "excluded")))
			.orderBy(sql`${results.matchScore} desc nulls last`);
	}

	async countsByContentType(
		jobId: string,
	): Promise<readonly ContentTypeCount[]> {
		const rows = await this.db
			.select({ c: count(), contentType: results.contentType })
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "included")))
			.groupBy(results.contentType);
		return rows
			.filter((r) => r.contentType !== null)
			.map((r) => ({
				contentType: r.contentType as string,
				count: Number(r.c),
			}));
	}
}
