import { selectSummariseInput } from "../../domain/summarise/select-input";
import { summariseWarnings } from "../../domain/summarise/summarise-warnings";
import type { RunContext } from "../pipeline/run-context";
import type { Stage } from "../pipeline/stage.port";
import type { ResultRepository } from "../search/ports/result-repository.port";
import type { SummarisePort } from "./ports/summarise.port";
import type { SummaryRepository } from "./ports/summary-repository.port";

/**
 * The Summarise stage — fifth / last. One read of the `included` pool → empty-case Warning, OR one
 * Haiku call per Job → save the validated Summary, OR record a single failure Warning. It NEVER throws
 * JobFailedError, never sets ctx.resolvedIdentity, never writes to `results`, and never fetches a page.
 * The company name comes from the Resolved Identity Resolve populated (Resolve runs first / Summarise
 * runs last, so it is non-null by the time this stage runs).
 */
export class SummariseStage implements Stage {
	readonly name = "summarise";

	constructor(
		private readonly summarise: SummarisePort,
		private readonly summaries: SummaryRepository,
		private readonly results: ResultRepository,
	) {}

	async run(ctx: RunContext): Promise<void> {
		const identity = ctx.resolvedIdentity;
		if (identity === undefined) {
			// Programming/ordering fault: Resolve must run first. The runner routes this to `fail`.
			throw new Error(
				"SummariseStage requires a ResolvedIdentity (Resolve must run first)",
			);
		}

		// 1. Read the surviving input (`included`-only by query).
		const rows = await this.results.findIncludedForSummary(ctx.job.id);
		const input = selectSummariseInput(rows, identity.companyName);

		// 2. Empty case — nothing to digest. The all-Excluded Job's `done_with_warnings` flag.
		if (input.items.length === 0) {
			ctx.recordWarning(summariseWarnings.summariseEmpty());
			return;
		}

		// 3. Digest — exactly ONE Haiku call per Job.
		const result = await this.summarise.summarise(input);

		// 4. Failure case — adapter error OR Zod-validation failure (both { ok: false }). Summary stays absent.
		if (!result.ok) {
			ctx.recordWarning(summariseWarnings.summariseFailed());
			return;
		}

		// 5. Success — persist the one validated Summary. No Warning.
		await this.summaries.save(ctx.job.id, result.summary);
	}
}
