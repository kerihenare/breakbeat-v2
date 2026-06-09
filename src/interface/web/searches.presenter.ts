import type { JobListItem } from "../../application/ports/read-models.port";
import { jobStatusView } from "./view-models/job-status.vm";
import { paginate } from "./view-models/pagination.vm";

const PAGE_SIZE = 20;

/** Locals for the Results (searches) list page. */
export function buildSearchesLocals(
	items: readonly JobListItem[],
	total: number,
	page: number,
): object {
	return {
		basePath: "/searches",
		jobs: items.map((j) => ({
			company: j.anchorLabel,
			createdAt: j.createdAt.toISOString().slice(0, 10),
			id: j.id,
			includedCount: j.includedCount,
			status: jobStatusView(j.state),
		})),
		pagination: paginate(total, page, PAGE_SIZE),
	};
}
