import {
	and,
	count,
	desc,
	eq,
	inArray,
	isNull,
	type SQL,
	sql,
} from "drizzle-orm";
import type {
	ContentTypeCount,
	JobListItem,
	JobsListReadModel,
	Paged,
	ProfileCardView,
	ResolvedIdentityReadModel,
	ResultDetailRow,
	ResultReadRow,
	ResultsReadModel,
	SummaryReadModel,
	SummaryView,
} from "../../application/ports/read-models.port";
import type { BrandContext } from "../../domain/resolve/brand-context";
import type { Database } from "./database";
import {
	jobs,
	resolvedIdentities,
	resolvedIdentityCollisions,
	resolvedIdentityHandles,
	resolvedIdentityOwnDomains,
	results,
	summaries,
} from "./schema";

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

/** The Page (individual Result) route also reads the snippet, extracted content + takeaway. */
const resultDetailColumns = {
	...resultColumns,
	extractedContent: results.extractedContent,
	snippet: results.snippet,
	takeaway: results.takeaway,
};

/** The content-type filter for the included list. "unclassified" → the NULL bucket. */
type ContentTypeValue = (typeof results.contentType.enumValues)[number];

function contentTypeFilter(
	contentType: string | null | undefined,
): SQL | undefined {
	if (contentType === null || contentType === undefined) return undefined;
	if (contentType === "unclassified") return isNull(results.contentType);
	return eq(results.contentType, contentType as ContentTypeValue);
}

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
		contentType?: string | null,
	): Promise<Paged<ResultReadRow>> {
		const offset = Math.max(0, (page - 1) * pageSize);
		const where = and(
			eq(results.jobId, jobId),
			eq(results.status, "included"),
			contentTypeFilter(contentType),
		);
		const items = await this.db
			.select(resultColumns)
			.from(results)
			.where(where)
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
			.where(where);
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
		// The NULL content-type bucket surfaces as the "unclassified" chip.
		return rows.map((r) => ({
			contentType: r.contentType ?? "unclassified",
			count: Number(r.c),
		}));
	}

	async detail(
		jobId: string,
		resultId: string,
	): Promise<ResultDetailRow | null> {
		const [row] = await this.db
			.select(resultDetailColumns)
			.from(results)
			.where(and(eq(results.jobId, jobId), eq(results.id, resultId)))
			.limit(1);
		return row ?? null;
	}
}

export class DrizzleResolvedIdentityReadModel
	implements ResolvedIdentityReadModel
{
	constructor(private readonly db: Database) {}

	async find(jobId: string): Promise<ProfileCardView | null> {
		const [identity] = await this.db
			.select()
			.from(resolvedIdentities)
			.where(eq(resolvedIdentities.jobId, jobId))
			.limit(1);
		if (!identity) return null;

		const [domains, handles, [collision]] = await Promise.all([
			this.db
				.select({
					domain: resolvedIdentityOwnDomains.domain,
					provenance: resolvedIdentityOwnDomains.provenance,
				})
				.from(resolvedIdentityOwnDomains)
				.where(eq(resolvedIdentityOwnDomains.jobId, jobId)),
			this.db
				.select({
					handle: resolvedIdentityHandles.handle,
					platform: resolvedIdentityHandles.platform,
					url: resolvedIdentityHandles.url,
				})
				.from(resolvedIdentityHandles)
				.where(eq(resolvedIdentityHandles.jobId, jobId)),
			this.db
				.select({ c: count() })
				.from(resolvedIdentityCollisions)
				.where(eq(resolvedIdentityCollisions.jobId, jobId)),
		]);

		// brand_context is validated structured output (BrandContext | null), stored as JSONB.
		const bc = identity.brandContext as BrandContext | null;
		return {
			collisionCount: Number(collision?.c ?? 0),
			companyName: identity.companyName,
			description: bc?.description ?? null,
			handles,
			ownDomains: domains,
			tagline: bc?.tagline ?? null,
			tags: bc?.tags ?? [],
		};
	}
}

export class DrizzleSummaryReadModel implements SummaryReadModel {
	constructor(private readonly db: Database) {}

	async find(jobId: string): Promise<SummaryView | null> {
		const [row] = await this.db
			.select({ summary: summaries.summary })
			.from(summaries)
			.where(eq(summaries.jobId, jobId))
			.limit(1);
		return row ? { digest: row.summary } : null;
	}
}
