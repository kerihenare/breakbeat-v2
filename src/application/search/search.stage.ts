import { JobFailedError } from "../../domain/job/job-errors";
import { shouldEscalate } from "../../domain/search/escalation";
import { buildQueryPlan } from "../../domain/search/query-plan";
import { searchWarnings } from "../../domain/search/search-warnings";
import type { RunContext } from "../pipeline/run-context";
import type { Stage } from "../pipeline/stage.port";
import type { Clock } from "../ports/clock.port";
import type { ResultRepository } from "./ports/result-repository.port";
import type { TavilySearchPort } from "./ports/tavily-search.port";
import type { WebSearchBackstopPort } from "./ports/web-search-backstop.port";
import type { SearchConfig } from "./search-config";
import { SearchSweep } from "./search-sweep";

/**
 * SearchStage — the second pipeline stage and the only impure unit of Search. It
 * composes the three ports + config + Foundation's Clock, threads the broad-then-
 * escalate flow, and decides Warning-vs-fail from how many calls succeeded. Every
 * source failure is a benign value (`{ hits: [], failed: true }`) the SearchSweep
 * counts, so the shell branches on values, never exceptions: partial failure is a
 * Warning and only a total wipeout fails the Job. Search writes the provisional
 * Match Score only — never verification_status — and Excludes nothing (born-`included`).
 */
export class SearchStage implements Stage {
	readonly name = "search";

	constructor(
		private readonly tavily: TavilySearchPort,
		private readonly backstop: WebSearchBackstopPort,
		private readonly repo: ResultRepository,
		private readonly config: SearchConfig,
		private readonly clock: Clock,
	) {}

	async run(ctx: RunContext): Promise<void> {
		const identity = ctx.resolvedIdentity;
		if (identity === undefined) {
			// Programming/ordering fault: Resolve must run first. Let it become an
			// unexpected throw the runner routes to `fail` (Foundation).
			throw new Error(
				"SearchStage requires a ResolvedIdentity (Resolve must run first)",
			);
		}
		const plan = buildQueryPlan(identity, this.clock.now(), this.config);
		const sweep = new SearchSweep(ctx.job.id, this.repo);
		let backstopFailed = false;

		// 1. Broad set — always. Sum the rows ACTUALLY inserted (post-URL-dedup) =
		//    distinct broad Results.
		const broad = await Promise.all(
			plan.broad.map((q) =>
				this.tavily.search(q).then((r) => sweep.absorb(r, "tavily")),
			),
		);
		const distinctBroad = broad.reduce((sum, n) => sum + n, 0);

		// 2. Gate — after the broad set has fully inserted and dedup settled (never
		//    mid-sweep). One scalar threshold authorises BOTH escalations (ADR 0002).
		if (shouldEscalate(distinctBroad, this.config.lowYieldThreshold)) {
			const escalated = [...plan.angle, ...plan.typeTargeted].map((q) =>
				this.tavily.search(q).then((r) => sweep.absorb(r, "tavily")),
			);
			const rescue = this.backstop.search(identity.companyName).then((r) => {
				backstopFailed = r.failed;
				return sweep.absorb(r, "web_search_backstop");
			});
			await Promise.all([...escalated, rescue]);
		}

		// 3. Outcome.
		if (sweep.succeeded === 0) {
			// Nothing to show: every attempted call across every attempted source failed.
			throw new JobFailedError("All search queries across all sources failed");
		}
		if (sweep.failed > 0) {
			ctx.recordWarning(searchWarnings.queriesPartiallyFailed(sweep.failed));
		}
		if (backstopFailed) ctx.recordWarning(searchWarnings.backstopFailed());
	}
}
