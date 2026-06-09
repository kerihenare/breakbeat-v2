import type {
	ContentTypeCount,
	Paged,
	ResultReadRow,
} from "../../application/ports/read-models.port";
import type { CompanyAnchor } from "../../domain/job/company-anchor";
import type { Job } from "../../domain/job/job";
import { contentTypeView } from "./view-models/content-type.vm";
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
): object {
	const status = jobStatusView(job.state);
	const isFailed = job.state === "failed";
	return {
		basePath: `/jobs/${job.id}`,
		chips: counts.map((c) => ({
			...contentTypeView(c.contentType),
			count: c.count,
		})),
		company: anchorLabel(job.anchor),
		excluded: excluded.map(resultRowView),
		failureReason: job.failureReason,
		isEmptyFinding: status.isTerminal && !isFailed && included.total === 0,
		isFailed,
		isTerminal: status.isTerminal,
		jobId: job.id,
		pagination: paginate(included.total, page, PAGE_SIZE),
		resolvedIdentity: null, // PRD 2
		rows: included.items.map(resultRowView),
		status,
		summary: null, // PRD 6
		warnings: job.warnings,
	};
}
