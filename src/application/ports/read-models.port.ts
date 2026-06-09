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
	readonly contentType: string;
	readonly count: number;
}

/** The Results list (Jobs), most-recent first. */
export interface JobsListReadModel {
	list(page: number, pageSize: number): Promise<Paged<JobListItem>>;
}

export const JOBS_LIST_READ_MODEL = Symbol("JobsListReadModel");

/** A Job's Results — included page (by Match Score desc), the excluded set, and chip counts. */
export interface ResultsReadModel {
	includedPage(
		jobId: string,
		page: number,
		pageSize: number,
	): Promise<Paged<ResultReadRow>>;
	excluded(jobId: string): Promise<readonly ResultReadRow[]>;
	countsByContentType(jobId: string): Promise<readonly ContentTypeCount[]>;
}

export const RESULTS_READ_MODEL = Symbol("ResultsReadModel");
