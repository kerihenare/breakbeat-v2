import type { BrandContext } from "../../domain/resolve/brand-context";
import type { NameCollision } from "../../domain/resolve/name-collision";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import type {
	resolvedIdentities,
	resolvedIdentityCollisions,
	resolvedIdentityHandles,
	resolvedIdentityOwnDomains,
} from "./schema";

type ParentRow = typeof resolvedIdentities.$inferSelect;
type DomainRow = typeof resolvedIdentityOwnDomains.$inferSelect;
type HandleRow = typeof resolvedIdentityHandles.$inferSelect;
type CollisionRow = typeof resolvedIdentityCollisions.$inferSelect;

export type IdentityRows = {
	parent: typeof resolvedIdentities.$inferInsert;
	ownDomains: (typeof resolvedIdentityOwnDomains.$inferInsert)[];
	handles: (typeof resolvedIdentityHandles.$inferInsert)[];
	collisions: (typeof resolvedIdentityCollisions.$inferInsert)[];
};

/** A ResolvedIdentity → the parent insert + its three child insert arrays. */
export function identityToRows(
	jobId: string,
	identity: ResolvedIdentity,
): IdentityRows {
	return {
		collisions: identity.nameCollisions.map((c) => ({
			brandId: c.brandId,
			context: c.context,
			domain: c.domain,
			jobId,
			name: c.name,
		})),
		handles: identity.socialHandles.map((h) => ({
			handle: h.handle,
			jobId,
			platform: h.platform,
			url: h.url,
		})),
		ownDomains: identity.ownDomains.map((d) => ({
			domain: d.domain,
			jobId,
			provenance: d.provenance,
		})),
		parent: {
			brandContext: identity.brandContext,
			companyName: identity.companyName,
			jobId,
			negativeBoost: identity.negativeBoost,
		},
	};
}

/** Persisted rows → the ResolvedIdentity value object (re-frozen via `assemble`). */
export function rowsToIdentity(
	parent: ParentRow,
	domains: DomainRow[],
	handles: HandleRow[],
	collisions: CollisionRow[],
): ResolvedIdentity {
	return ResolvedIdentity.assemble({
		brandContext: (parent.brandContext as BrandContext | null) ?? null,
		companyName: parent.companyName,
		nameCollisions: collisions.map(
			(c): NameCollision => ({
				brandId: c.brandId,
				context: (c.context as NameCollision["context"]) ?? null,
				domain: c.domain,
				name: c.name,
			}),
		),
		negativeBoost: parent.negativeBoost,
		ownDomains: domains.map((d) => ({
			domain: d.domain,
			provenance: d.provenance,
		})),
		socialHandles: handles.map((h) => ({
			handle: h.handle,
			platform: h.platform,
			url: h.url,
		})),
	});
}
