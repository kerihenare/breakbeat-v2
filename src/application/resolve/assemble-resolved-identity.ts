import type { Warning } from "../../domain/job/warning";
import type { BrandContext } from "../../domain/resolve/brand-context";
import type { NameCollision } from "../../domain/resolve/name-collision";
import { deriveNegativeBoost } from "../../domain/resolve/negative-boost";
import type { OwnDomain } from "../../domain/resolve/own-domain";
import { resolveWarnings } from "../../domain/resolve/resolve-warnings";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import type { SocialHandle } from "../../domain/resolve/social-handle";

export type AssemblyFlags = {
	homepageUnresolved: boolean;
	homepageFetchFailed: boolean;
	collisionContextFailures: number;
	targetInferred: boolean;
};

export type AssemblyInput = {
	canonicalBrandName: string | null;
	homepageConfirmedName: string | null;
	anchorName: string | null;
	// Last-resort name for a disambiguated anchor with nothing else.
	anchorDomainForName: string | null;
	ownDomain: OwnDomain | null;
	handles: readonly SocialHandle[];
	brandContext: BrandContext | null;
	collisions: readonly NameCollision[];
	flags: AssemblyFlags;
};

export type AssemblyOutput = {
	identity: ResolvedIdentity;
	warnings: Warning[];
};

/** Pure composition of port outputs into one Resolved Identity + its Warnings. Never re-chooses. */
export function assembleResolvedIdentity(input: AssemblyInput): AssemblyOutput {
	const companyName =
		nonBlank(input.canonicalBrandName) ??
		nonBlank(input.homepageConfirmedName) ??
		nonBlank(input.anchorName) ??
		nonBlank(input.anchorDomainForName) ??
		"unknown";

	const identity = ResolvedIdentity.assemble({
		brandContext: input.brandContext,
		companyName,
		nameCollisions: input.collisions,
		negativeBoost: deriveNegativeBoost(input.collisions),
		ownDomains: input.ownDomain ? [input.ownDomain] : [],
		socialHandles: input.handles,
	});

	const warnings: Warning[] = [];
	if (input.flags.homepageUnresolved)
		warnings.push(resolveWarnings.homepageUnresolved());
	if (input.flags.homepageFetchFailed)
		warnings.push(resolveWarnings.homepageFetchFailed());
	if (input.brandContext === null)
		warnings.push(resolveWarnings.brandContextAbsent());
	if (input.flags.collisionContextFailures > 0)
		warnings.push(
			resolveWarnings.collisionContextFetchFailed(
				input.flags.collisionContextFailures,
			),
		);
	if (input.flags.targetInferred)
		warnings.push(resolveWarnings.collisionTargetInferred());

	return { identity, warnings };
}

function nonBlank(s: string | null): string | null {
	return s && s.trim() !== "" ? s : null;
}
