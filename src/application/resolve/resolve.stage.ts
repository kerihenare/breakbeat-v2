import { deSelfCollisions } from "../../domain/resolve/de-self";
import type { RunContext } from "../pipeline/run-context";
import type { Stage } from "../pipeline/stage.port";
import {
	type AssemblyFlags,
	assembleResolvedIdentity,
} from "./assemble-resolved-identity";
import { fetchCollisionContexts } from "./fetch-collision-contexts";
import type { BrandPort } from "./ports/brand.port";
import type { BrandContextPort } from "./ports/brand-context.port";
import type { BrandSearchPort } from "./ports/brand-search.port";
import type {
	HomepageFetchPort,
	HomepageFetchResult,
} from "./ports/homepage-fetch.port";
import type { ResolvedIdentityRepository } from "./ports/resolved-identity-repository.port";
import { resolveAnchorDomain } from "./resolve-anchor-domain";

/**
 * ResolveStage — the first pipeline stage and the only impure unit of Resolve.
 * It composes the four ports + the repository and threads the result onto the
 * RunContext. Every BrandFetch/homepage failure is a benign value (null/[]), so
 * the shell branches on values, never exceptions: degraded paths become
 * Warnings, never Job failures. No Anthropic dependency (ADR 0001).
 */
export class ResolveStage implements Stage {
	readonly name = "resolve";

	constructor(
		private readonly brandSearch: BrandSearchPort,
		private readonly brand: BrandPort,
		private readonly brandContext: BrandContextPort,
		private readonly homepage: HomepageFetchPort,
		private readonly repo: ResolvedIdentityRepository,
	) {}

	async run(ctx: RunContext): Promise<void> {
		const flags: AssemblyFlags = {
			collisionContextFailures: 0,
			homepageFetchFailed: false,
			homepageUnresolved: false,
			targetInferred: false,
		};

		// 1. Resolve the anchor to a working domain (+ canonical brand for name & de-self).
		const resolution = await resolveAnchorDomain(ctx.job.anchor, this.brand);
		const domain = resolution.domain;

		// 2 & 3. Target Brand Context + the one true homepage fetch (only with a domain).
		const brandContext = domain
			? await this.brandContext.fetchContext(domain)
			: null;
		const homepage: HomepageFetchResult | null = domain
			? await this.homepage.fetch(domain)
			: null;
		if (!domain) flags.homepageUnresolved = true;
		else if (!homepage) flags.homepageFetchFailed = true;

		// 4. Discover + de-self collisions (name from the frozen anchor, never search).
		const name = resolution.canonicalBrand?.name ?? resolution.anchorName ?? "";
		const hits = name ? await this.brandSearch.search(name) : [];
		const { collisions: candidates, inferredTarget } = deSelfCollisions(
			hits,
			{
				brandId: resolution.canonicalBrand?.brandId ?? null,
				primaryDomain: resolution.canonicalBrand?.primaryDomain ?? null,
			},
			domain,
		);
		flags.targetInferred = inferredTarget;

		// 5. Per-collision context (concurrent, individually failure-tolerant).
		const { collisions, failures } = await fetchCollisionContexts(
			candidates,
			this.brandContext,
		);
		flags.collisionContextFailures = failures;

		// 6. Assemble + record warnings.
		const { identity, warnings } = assembleResolvedIdentity({
			anchorDomainForName: domain,
			anchorName: resolution.anchorName,
			brandContext,
			canonicalBrandName: resolution.canonicalBrand?.name ?? null,
			collisions,
			flags,
			handles: homepage?.handles ?? [],
			homepageConfirmedName: homepage?.confirmedName ?? null,
			ownDomain: resolution.ownDomain,
		});
		for (const w of warnings) ctx.recordWarning(w);

		// 7 & 8. Hand off in-process + persist for PRD 7 / re-run read model.
		ctx.setResolvedIdentity(identity);
		await this.repo.save(ctx.job.id, identity);
	}
}
