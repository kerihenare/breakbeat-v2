import { type Warning, warning } from "../job/warning";

/**
 * The closed set of Resolve Warning types, namespaced under `resolve.`. Each maps
 * one-to-one to the PRD's "Warning conditions (closed list)". A Warning is a
 * partial *success*, never an error (CONTEXT.md "Warning").
 */
export const RESOLVE_WARNING = {
	brandContextAbsent: "resolve.brand_context_absent",
	collisionContextFetchFailed: "resolve.collision_context_fetch_failed",
	collisionTargetInferred: "resolve.collision_target_inferred",
	homepageFetchFailed: "resolve.homepage_fetch_failed",
	homepageUnresolved: "resolve.homepage_unresolved",
} as const;

// Messages carry counts/identifiers only — never scraped page text or raw
// payloads (anti-echo).
export const resolveWarnings = {
	brandContextAbsent: (): Warning =>
		warning(
			RESOLVE_WARNING.brandContextAbsent,
			"No Brand Context resolved for the target; Verify runs without positive context.",
		),
	collisionContextFetchFailed: (count: number): Warning =>
		warning(
			RESOLVE_WARNING.collisionContextFetchFailed,
			`${count} Name Collision context fetch(es) failed; affected collisions carry no mini-context.`,
		),
	collisionTargetInferred: (): Warning =>
		warning(
			RESOLVE_WARNING.collisionTargetInferred,
			"Name-only anchor: target was inferred (not exactly matched) when de-selfing the collision set.",
		),
	homepageFetchFailed: (): Warning =>
		warning(
			RESOLVE_WARNING.homepageFetchFailed,
			"Homepage fetch failed; kept the supplied host as an own domain, handles not scraped, name not confirmed.",
		),
	homepageUnresolved: (): Warning =>
		warning(
			RESOLVE_WARNING.homepageUnresolved,
			"No homepage resolved; proceeding without own domains or scraped handles.",
		),
};
