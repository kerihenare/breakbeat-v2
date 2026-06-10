import type { BrandContext } from "./brand-context";
import type { NameCollision } from "./name-collision";
import type { OwnDomain } from "./own-domain";
import type { SocialHandle } from "./social-handle";

export type ResolvedIdentityParts = {
	companyName: string;
	ownDomains: readonly OwnDomain[];
	socialHandles: readonly SocialHandle[];
	brandContext: BrandContext | null;
	nameCollisions: readonly NameCollision[];
	negativeBoost: string;
};

/**
 * ResolvedIdentity — the immutable, job-scoped anchor produced once per Job by
 * the Resolve stage (PRD 2). `assemble` is the single constructor; it freezes
 * the arrays so no later stage can mutate the anchor (story 20). It is derived
 * per-run and strictly distinct from the frozen CompanyAnchor.
 */
export class ResolvedIdentity {
	readonly companyName: string;
	readonly ownDomains: readonly OwnDomain[];
	readonly socialHandles: readonly SocialHandle[];
	readonly brandContext: BrandContext | null;
	readonly nameCollisions: readonly NameCollision[];
	readonly negativeBoost: string;

	private constructor(parts: ResolvedIdentityParts) {
		this.companyName = parts.companyName;
		this.ownDomains = Object.freeze([...parts.ownDomains]);
		this.socialHandles = Object.freeze([...parts.socialHandles]);
		this.brandContext = parts.brandContext;
		this.nameCollisions = Object.freeze([...parts.nameCollisions]);
		this.negativeBoost = parts.negativeBoost;
		Object.freeze(this);
	}

	static assemble(parts: ResolvedIdentityParts): ResolvedIdentity {
		if (parts.companyName.trim() === "") {
			throw new Error("ResolvedIdentity requires a non-empty company name");
		}
		return new ResolvedIdentity(parts);
	}
}
