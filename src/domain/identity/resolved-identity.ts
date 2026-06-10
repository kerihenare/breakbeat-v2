/**
 * ResolvedIdentity — derived per-run by the Resolve stage (PRD 2), strictly
 * distinct from the frozen CompanyAnchor.
 *
 * Foundation reserved this module to hold the minimal shape the RunContext slot
 * needs. PRD 2 fleshed it out as a rich immutable value object living in
 * `domain/resolve/`; this module re-exports it so the historical import path
 * (e.g. `application/pipeline/run-context.ts`) stays stable and there is exactly
 * one canonical ResolvedIdentity type across the codebase.
 */
export { ResolvedIdentity } from "../resolve/resolved-identity";
