import { registrableDomain } from "./registrable-domain";

// Structural shapes (the ports' return types satisfy these; kept local so the
// domain has no port import).
export type BrandSearchHitLike = {
	brandId: string | null;
	name: string;
	domain: string | null;
	relevance: number | null;
};
export type CanonicalBrandLike = {
	brandId: string | null;
	primaryDomain: string | null;
};

export type DeSelfResult = {
	collisions: BrandSearchHitLike[];
	inferredTarget: boolean;
};

/**
 * Removes the target itself from a Brand Search hit set before the Negative
 * Boost is derived. brandId match (strongest) → registrable-domain match
 * (fallback) → name-only top-relevance inference (sets inferredTarget so the
 * caller raises the collision_target_inferred Warning).
 */
export function deSelfCollisions(
	hits: readonly BrandSearchHitLike[],
	brand: CanonicalBrandLike,
	anchorDomain: string | null,
): DeSelfResult {
	if (hits.length === 0) return { collisions: [], inferredTarget: false };

	if (brand.brandId) {
		return {
			collisions: hits.filter((h) => h.brandId !== brand.brandId),
			inferredTarget: false,
		};
	}

	const targetDomain = registrableDomain(brand.primaryDomain ?? anchorDomain);
	if (targetDomain !== "") {
		return {
			collisions: hits.filter(
				(h) => registrableDomain(h.domain) !== targetDomain,
			),
			inferredTarget: false,
		};
	}

	// Name-only with no resolvable key: infer the single best hit as the target and Warn.
	const top = hits.reduce(
		(best, h) => ((h.relevance ?? 0) > (best.relevance ?? 0) ? h : best),
		hits[0],
	);
	return { collisions: hits.filter((h) => h !== top), inferredTarget: true };
}
