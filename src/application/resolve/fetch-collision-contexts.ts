import type { NameCollision } from "../../domain/resolve/name-collision";
import type { BrandContextPort } from "./ports/brand-context.port";
import type { BrandSearchHit } from "./ports/brand-search.port";

export type CollisionContextResult = {
	collisions: NameCollision[];
	failures: number;
};

/**
 * Fetches each de-selfed candidate's mini Brand Context (concurrently, each
 * individually failure-tolerant) and counts the failures so the caller can raise
 * one aggregate collisionContextFetchFailed Warning. A candidate with no domain
 * carries a null context and is not a failure.
 */
export async function fetchCollisionContexts(
	candidates: readonly BrandSearchHit[],
	brandContext: BrandContextPort,
): Promise<CollisionContextResult> {
	let failures = 0;
	const collisions = await Promise.all(
		candidates.map(async (hit): Promise<NameCollision> => {
			const context = hit.domain
				? await brandContext.fetchContext(hit.domain)
				: null;
			if (hit.domain && context === null) failures += 1;
			return {
				brandId: hit.brandId,
				context,
				domain: hit.domain ?? "",
				name: hit.name,
			};
		}),
	);
	return { collisions, failures };
}
