import type {
	ContentTypeCount,
	Paged,
	ProfileCardView,
	ResultDetailRow,
	ResultReadRow,
	SummaryView,
} from "../../application/ports/read-models.port";
import type { CompanyAnchor } from "../../domain/job/company-anchor";
import type { Job } from "../../domain/job/job";
import { renderResultList, renderStatusBadge } from "./njk-renderer";
import { deriveChips } from "./view-models/chips.vm";
import { jobStatusView } from "./view-models/job-status.vm";
import { paginate } from "./view-models/pagination.vm";
import { resultRowView } from "./view-models/result-row.vm";

const PAGE_SIZE = 20;

export function anchorLabel(anchor: CompanyAnchor): string {
	if (anchor.kind === "name_only") return anchor.name;
	return anchor.domain ?? anchor.brandId ?? "(company)";
}

/** Locals for the Result (live) page. Distinguishes empty-but-done from a failure. */
export function buildResultLocals(
	job: Job,
	included: Paged<ResultReadRow>,
	excluded: readonly ResultReadRow[],
	counts: readonly ContentTypeCount[],
	page: number,
	selectedType: string | null = null,
	reads: {
		profile?: ProfileCardView | null;
		summary?: SummaryView | null;
	} = {},
): object {
	const status = jobStatusView(job.state);
	const isFailed = job.state === "failed";
	return {
		basePath: `/jobs/${job.id}`,
		chips: deriveChips(counts, selectedType),
		company: anchorLabel(job.anchor),
		excluded: excluded.map(resultRowView),
		failureReason: job.failureReason,
		isEmptyFinding: status.isTerminal && !isFailed && included.total === 0,
		isFailed,
		isTerminal: status.isTerminal,
		jobId: job.id,
		pagination: paginate(included.total, page, PAGE_SIZE),
		// PRD 2 Resolved Identity profile card + PRD 6 Job-level Summary (null until
		// those stages have written; the template degrades honestly).
		resolvedIdentity: reads.profile ?? null,
		rows: included.items.map(resultRowView),
		// The active filter (null = "All"); chip + paginator links preserve it.
		selectedType,
		status,
		summary: reads.summary?.digest ?? null,
		warnings: job.warnings,
	};
}

/** The live SSE frame: re-rendered page-1 list + status badge HTML (parity with the page). */
export interface StreamFrame {
	readonly count: number;
	readonly isTerminal: boolean;
	readonly listHtml: string;
	readonly statusHtml: string;
}

export function buildStreamFrame(
	job: Job,
	included: Paged<ResultReadRow>,
): StreamFrame {
	const status = jobStatusView(job.state);
	return {
		count: included.total,
		isTerminal: status.isTerminal,
		listHtml: renderResultList({
			basePath: `/jobs/${job.id}`,
			isTerminal: status.isTerminal,
			rows: included.items.map(resultRowView),
			selectedType: null,
		}),
		statusHtml: renderStatusBadge(status),
	};
}

/** Locals for the Page (individual Result) route — trust facts + extracted content + takeaway. */
export function buildResultDetailLocals(
	job: Job,
	detail: ResultDetailRow,
): object {
	const row = resultRowView(detail);
	return {
		backPath: `/jobs/${job.id}`,
		company: anchorLabel(job.anchor),
		extractedContent: detail.extractedContent,
		row,
		snippet: detail.snippet,
		takeaway: detail.takeaway,
		url: detail.url,
	};
}
