import { type CollapseInput, collapse } from "../../domain/filter/collapse";
import type { FilterConfig } from "../../domain/filter/filter-config";
import { filterWarnings } from "../../domain/filter/filter-warnings";
import { heuristicExclusion } from "../../domain/filter/heuristic-exclusion";
import { registrableDomain, resultHost } from "../../domain/filter/result-host";
import type { RunContext } from "../pipeline/run-context";
import type { Stage } from "../pipeline/stage.port";
import type { Clock } from "../ports/clock.port";
import type { ResultRepository } from "../search/ports/result-repository.port";

/**
 * The third pipeline stage. Soft-Excludes structurally-obvious noise (heuristic pass) and then
 * Collapses near-identical re-prints to the earliest copy (Collapse pass) — pure deterministic
 * logic, no network, no LLM. Never fails the Job; a degraded (name-only) identity is a Warning.
 */
export class FilterStage implements Stage {
	readonly name = "filter";

	constructor(
		private readonly repo: ResultRepository,
		private readonly config: FilterConfig,
		private readonly clock: Clock,
	) {}

	async run(ctx: RunContext): Promise<void> {
		const identity = ctx.resolvedIdentity;
		if (identity === undefined) {
			// Programming/ordering fault: Resolve must run first. The runner routes this to `fail`.
			throw new Error(
				"FilterStage requires a ResolvedIdentity (Resolve must run first)",
			);
		}

		if (identity.ownDomains.length === 0) {
			ctx.recordWarning(filterWarnings.ownChannelDegraded());
		}

		const now = this.clock.now();
		const pool = await this.repo.findIncluded(ctx.job.id);

		// Heuristic pass — Exclude the first matching code; survivors flow into Collapse.
		const survivors: typeof pool = [];
		for (const result of pool) {
			const code = heuristicExclusion(result, identity, now, this.config);
			if (code !== null) {
				await this.repo.recordExclusion(result.id, code, null);
			} else {
				survivors.push(result);
			}
		}

		// Collapse pass — over survivors only; losers point at the earliest-published winner.
		const inputs: CollapseInput[] = survivors.map((r) => ({
			id: r.id,
			publishedDate: r.publishedDate,
			sourceDomain: registrableDomain(resultHost(r.url)),
			title: r.title,
		}));
		for (const loser of collapse(inputs, identity.companyName, this.config)) {
			await this.repo.recordExclusion(
				loser.loserId,
				"duplicate",
				`of:${loser.winnerId}`,
			);
		}
	}
}
