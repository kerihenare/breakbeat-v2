/**
 * Read-model ports the UI queries (PRD 7). All UI reads go through these —
 * never against pipeline internals. Match Score is the sort key throughout and
 * is read as it currently stands (provisional → interim → authoritative); the
 * UI never computes or re-ranks it.
 */

/** The raw read shape for one Result (the columns the UI renders). */
export interface ResultReadRow {
	readonly id: string;
	readonly title: string | null;
	readonly url: string;
	readonly sourceDomain: string | null;
	readonly publishedDate: Date | null;
	readonly status: "included" | "excluded";
	readonly exclusionCode: string | null;
	readonly exclusionDetail: string | null;
	readonly matchScore: number | null;
	readonly verificationStatus: string | null;
	readonly contentType: string | null;
	readonly sentiment: string | null;
}

export interface JobListItem {
	readonly id: string;
	readonly anchorLabel: string;
	readonly state: string;
	readonly includedCount: number;
	readonly createdAt: Date;
}

export interface Paged<T> {
	readonly items: readonly T[];
	readonly total: number;
}

export interface ContentTypeCount {
	readonly contentType: string; // a content type, or "unclassified" for the NULL bucket
	readonly count: number;
}

/** One Result with the full detail the Page (individual Result) route renders. */
export interface ResultDetailRow extends ResultReadRow {
	readonly snippet: string | null;
	readonly extractedContent: string | null;
	readonly takeaway: string | null;
}

/** The Results list (Jobs), most-recent first. */
export interface JobsListReadModel {
	list(page: number, pageSize: number): Promise<Paged<JobListItem>>;
}

export const JOBS_LIST_READ_MODEL = Symbol("JobsListReadModel");

/** A Job's Results — included page (by Match Score desc), the excluded set, and chip counts. */
export interface ResultsReadModel {
	/**
	 * Page-1-first slice of included Results by Match Score desc (NULLs last).
	 * `contentType` filters to one type ("unclassified" → the NULL bucket);
	 * undefined/null returns every included Result.
	 */
	includedPage(
		jobId: string,
		page: number,
		pageSize: number,
		contentType?: string | null,
	): Promise<Paged<ResultReadRow>>;
	excluded(jobId: string): Promise<readonly ResultReadRow[]>;
	countsByContentType(jobId: string): Promise<readonly ContentTypeCount[]>;
	/** One included-or-excluded Result with its extracted content + takeaway, or null. */
	detail(jobId: string, resultId: string): Promise<ResultDetailRow | null>;
}

export const RESULTS_READ_MODEL = Symbol("ResultsReadModel");

/** The Resolved Identity profile card the Result page shows (PRD 2 output, read by PRD 7). */
export interface ProfileCardView {
	readonly companyName: string;
	readonly tagline: string | null;
	readonly description: string | null;
	readonly tags: readonly string[];
	readonly ownDomains: readonly { domain: string; provenance: string }[];
	readonly handles: readonly {
		platform: string;
		handle: string;
		url: string;
	}[];
	readonly collisionCount: number;
}

export interface ResolvedIdentityReadModel {
	find(jobId: string): Promise<ProfileCardView | null>;
}

export const RESOLVED_IDENTITY_READ_MODEL = Symbol("ResolvedIdentityReadModel");

/** The Job-level Summary digest (PRD 6 output, read by PRD 7). */
export interface SummaryView {
	readonly digest: string;
}

export interface SummaryReadModel {
	find(jobId: string): Promise<SummaryView | null>;
}

export const SUMMARY_READ_MODEL = Symbol("SummaryReadModel");
