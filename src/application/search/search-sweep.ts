import type {
	ResultRepository,
	ResultSource,
} from "./ports/result-repository.port";
import type { SearchSourceResult } from "./ports/tavily-search.port";
import { toResultInserts } from "./to-result-insert";

/**
 * Accumulates one Job's sweep: it absorbs each source call into the
 * `ResultRepository` (the unique constraint does insert-time URL-dedup) and tallies
 * how many calls succeeded vs failed. A failed call contributes zero Results and is
 * counted, never thrown — so the stage decides Warning-vs-fail from `succeeded` /
 * `failed`, not from catching exceptions. `distinctInserted` sums the post-dedup
 * rows the repository actually wrote, which is the escalation gate's input.
 */
export class SearchSweep {
	private _succeeded = 0;
	private _failed = 0;

	constructor(
		private readonly jobId: string,
		private readonly repo: ResultRepository,
	) {}

	get succeeded(): number {
		return this._succeeded;
	}

	get failed(): number {
		return this._failed;
	}

	/** Absorb one source call; returns the distinct (post-dedup) Results it inserted. */
	async absorb(
		result: SearchSourceResult,
		source: ResultSource,
	): Promise<number> {
		if (result.failed) {
			this._failed += 1;
			return 0;
		}
		this._succeeded += 1;
		return this.repo.insertIncluded(
			this.jobId,
			toResultInserts(result, source),
		);
	}
}
