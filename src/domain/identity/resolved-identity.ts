/**
 * ResolvedIdentity — reserved for PRD 2 (Resolve stage).
 *
 * Foundation defines only the minimal shape needed to reserve the RunContext
 * slot (see `application/pipeline/run-context.ts`) and its set-once semantics,
 * so later stages (Search, Verify) can read shared run state without reshaping
 * the runner. PRD 2 fleshes this out: own domains, scraped handles, Brand
 * Context, Name Collisions, and the derived Negative Boost.
 *
 * It is derived per-run and is strictly distinct from the frozen CompanyAnchor.
 */
export interface ResolvedIdentity {
	readonly companyName: string;
}
