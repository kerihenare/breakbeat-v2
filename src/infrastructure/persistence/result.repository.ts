import { and, desc, eq } from "drizzle-orm";
import type {
	FilterResult,
	FullTextOutcome,
	ResultInsert,
	ResultRepository,
	SummariseResultRow,
} from "../../application/search/ports/result-repository.port";
import type { ContentType } from "../../domain/analyze/content-type";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import type { Database } from "./database";
import * as analyzeWrites from "./result-analyze-writes";
import { results } from "./schema";

/**
 * Drizzle adapter for the ResultRepository port. `insertIncluded` writes born-
 * `included` Results and lets the `(job_id, normalized_url)` unique index absorb
 * any duplicate via `onConflictDoNothing` — the entire dedup mechanism, no
 * scan-for-duplicates code path. It returns the number of rows ACTUALLY inserted
 * (Drizzle's returning row count), which is the escalation gate's distinct-Result
 * input. Search writes the provisional Match Score only; verification_status and
 * the other stage columns stay NULL. A re-run is a new Job id with its own rows
 * (immutable history).
 */
export class ResultDrizzleRepository implements ResultRepository {
	constructor(private readonly db: Database) {}

	async insertIncluded(
		jobId: string,
		inserts: readonly ResultInsert[],
	): Promise<number> {
		if (inserts.length === 0) return 0;
		const inserted = await this.db
			.insert(results)
			.values(
				inserts.map((r) => ({
					jobId,
					matchScore: r.matchScore,
					normalizedUrl: r.normalizedUrl,
					// The column is a timestamp; a captured ISO date becomes midnight UTC.
					publishedDate: r.publishedDate ? new Date(r.publishedDate) : null,
					snippet: r.snippet,
					source: r.source,
					title: r.title,
					url: r.url,
					// status defaults to `included`; verification_status/content_type/etc. stay NULL.
				})),
			)
			.onConflictDoNothing({ target: [results.jobId, results.normalizedUrl] })
			.returning({ id: results.id });
		return inserted.length;
	}

	/** The Collapse pool: `included` rows only (an Excluded copy is never returned), with content columns. */
	async findIncluded(jobId: string): Promise<FilterResult[]> {
		const rows = await this.db
			.select({
				id: results.id,
				publishedDate: results.publishedDate,
				snippet: results.snippet,
				title: results.title,
				url: results.url,
			})
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "included")));

		return rows.map((r) => ({
			id: r.id,
			// The column is a timestamp; project the stored midnight-UTC back to its ISO date.
			publishedDate: r.publishedDate
				? r.publishedDate.toISOString().slice(0, 10)
				: null,
			snippet: r.snippet ?? "",
			title: r.title ?? "",
			url: r.url,
		}));
	}

	/**
	 * The only status transition Filter performs: included → excluded. The `status = 'included'`
	 * guard makes it idempotent and forecloses re-Excluding a row with a different code. It touches
	 * only the three Exclusion columns — `match_score` and ordering are untouched.
	 */
	async recordExclusion(
		resultId: string,
		code: ExclusionCode,
		detail: string | null,
	): Promise<void> {
		await this.db
			.update(results)
			.set({ exclusionCode: code, exclusionDetail: detail, status: "excluded" })
			.where(and(eq(results.id, resultId), eq(results.status, "included")));
	}

	// analyze writes (PRD 5) — thin delegations to result-analyze-writes; each touches only its
	// reserved/owned nullable column(s) and never `status`.
	async setInterimMatchScore(resultId: string, score: number): Promise<void> {
		await analyzeWrites.setInterimMatchScore(this.db, resultId, score);
	}

	async setProvisionalContentType(
		resultId: string,
		type: ContentType,
	): Promise<void> {
		await analyzeWrites.setProvisionalContentType(this.db, resultId, type);
	}

	async applyFullTextOutcome(
		resultId: string,
		outcome: FullTextOutcome,
	): Promise<void> {
		await analyzeWrites.applyFullTextOutcome(this.db, resultId, outcome);
	}

	async setExtractedContent(resultId: string, content: string): Promise<void> {
		await analyzeWrites.setExtractedContent(this.db, resultId, content);
	}

	/**
	 * Summarise's read: only rows whose status = 'included' at the moment Summarise runs, each carrying
	 * its snippet + Enhancement (takeaway/sentiment, both nullable). This query is the primary
	 * "Excluded Results never feed the digest" guarantee. Reads no url/title/published_date.
	 */
	async findIncludedForSummary(jobId: string): Promise<SummariseResultRow[]> {
		const rows = await this.db
			.select({
				sentiment: results.sentiment,
				snippet: results.snippet,
				takeaway: results.takeaway,
			})
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.status, "included")));
		return rows.map((r) => ({
			sentiment: r.sentiment ?? null,
			snippet: r.snippet ?? "",
			takeaway: r.takeaway ?? null,
		}));
	}

	/** Test-only read helper: Results for a Job ordered by Match Score descending. */
	async findOrderedByScore(
		jobId: string,
	): Promise<Array<{ matchScore: number | null; source: string | null }>> {
		const rows = await this.db
			.select({ matchScore: results.matchScore, source: results.source })
			.from(results)
			.where(eq(results.jobId, jobId))
			.orderBy(desc(results.matchScore));
		return rows.map((r) => ({ matchScore: r.matchScore, source: r.source }));
	}
}
