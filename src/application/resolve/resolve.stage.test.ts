import { describe, expect, it, vi } from "vitest";
import type { CompanyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import type { BrandContext } from "../../domain/resolve/brand-context";
import { RESOLVE_WARNING } from "../../domain/resolve/resolve-warnings";
import { RunContext } from "../pipeline/run-context";
import type { BrandPort } from "./ports/brand.port";
import type { BrandContextPort } from "./ports/brand-context.port";
import type { BrandSearchPort } from "./ports/brand-search.port";
import type { HomepageFetchPort } from "./ports/homepage-fetch.port";
import type { ResolvedIdentityRepository } from "./ports/resolved-identity-repository.port";
import { ResolveStage } from "./resolve.stage";

const NOW = new Date("2026-06-10T00:00:00.000Z");

function runningContext(anchor: CompanyAnchor): RunContext {
	const job = Job.create("job-1", anchor, NOW);
	job.start(NOW);
	return new RunContext(job);
}

const ctxData = (): BrandContext => ({
	description: "d",
	mission: null,
	productsAndServices: [],
	tagline: null,
	tags: [],
	targetAudienceSegments: [],
	valueProposition: "vp",
});

type Fakes = {
	brandSearch: BrandSearchPort;
	brand: BrandPort;
	brandContext: BrandContextPort;
	homepage: HomepageFetchPort;
	repo: ResolvedIdentityRepository;
};

function makeFakes(over: Partial<Fakes> = {}): Fakes {
	return {
		brand: {
			resolveBrand: vi.fn(async () => ({
				brandId: "target",
				name: "Aglow",
				primaryDomain: "getaglow.co",
			})),
		},
		brandContext: { fetchContext: vi.fn(async () => ctxData()) },
		brandSearch: {
			search: vi.fn(async () => [
				{
					brandId: "other",
					domain: "aglow.org",
					name: "Aglow International",
					relevance: 0.4,
				},
			]),
		},
		homepage: {
			fetch: vi.fn(async () => ({
				confirmedName: "Aglow",
				handles: [
					{ handle: "getaglow", platform: "x", url: "https://x.com/getaglow" },
				],
			})),
		},
		repo: { findByJobId: vi.fn(async () => null), save: vi.fn(async () => {}) },
		...over,
	};
}

const make = (f: Fakes) =>
	new ResolveStage(f.brandSearch, f.brand, f.brandContext, f.homepage, f.repo);

const urlAnchor: CompanyAnchor = {
	brandId: null,
	domain: "getaglow.co",
	kind: "disambiguated",
	provenance: "url_provided",
};
const nameAnchor: CompanyAnchor = {
	kind: "name_only",
	name: "Aglow",
	provenance: "name_only",
};

describe("ResolveStage", () => {
	it("has name 'resolve'", () => {
		expect(make(makeFakes()).name).toBe("resolve");
	});

	it("happy path (domain anchor): full identity, no warnings, sets ctx, saves repo", async () => {
		const f = makeFakes();
		const ctx = runningContext(urlAnchor);
		await make(f).run(ctx);

		const id = ctx.resolvedIdentity;
		if (!id) throw new Error("expected resolvedIdentity to be set");
		expect(id.companyName).toBe("Aglow");
		expect(id.ownDomains).toEqual([
			{ domain: "getaglow.co", provenance: "url_provided" },
		]);
		expect(id.socialHandles).toHaveLength(1);
		expect(id.brandContext).not.toBeNull();
		expect(id.nameCollisions).toHaveLength(1); // "other" survives de-self
		expect(id.negativeBoost).toContain("Aglow International");
		expect(ctx.job.warnings).toHaveLength(0);
		expect(f.repo.save).toHaveBeenCalledOnce();
	});

	it("name-only, no homepage: degraded with homepage_unresolved warning, proceeds", async () => {
		const f = makeFakes({
			brand: { resolveBrand: vi.fn(async () => null) },
			brandSearch: {
				search: vi.fn(async () => [
					{ brandId: null, domain: "aglow.org", name: "Aglow", relevance: 0.9 },
					{
						brandId: null,
						domain: "homeaglow.com",
						name: "HomeAglow",
						relevance: 0.3,
					},
				]),
			},
			homepage: { fetch: vi.fn(async () => null) },
		});
		const ctx = runningContext(nameAnchor);
		await make(f).run(ctx);

		const id = ctx.resolvedIdentity;
		if (!id) throw new Error("expected resolvedIdentity to be set");
		expect(id.companyName).toBe("Aglow");
		expect(id.ownDomains).toHaveLength(0);
		expect(id.socialHandles).toHaveLength(0);
		expect(id.brandContext).toBeNull();
		const types = ctx.job.warnings.map((w) => w.type);
		expect(types).toContain(RESOLVE_WARNING.homepageUnresolved);
		expect(types).toContain(RESOLVE_WARNING.collisionTargetInferred); // top hit inferred as target
		expect(f.homepage.fetch).not.toHaveBeenCalled();
	});

	it("url-provided, homepage fetch fails: keeps host as own domain, warns, proceeds", async () => {
		const f = makeFakes({ homepage: { fetch: vi.fn(async () => null) } });
		const ctx = runningContext(urlAnchor);
		await make(f).run(ctx);

		const id = ctx.resolvedIdentity;
		if (!id) throw new Error("expected resolvedIdentity to be set");
		expect(id.ownDomains).toEqual([
			{ domain: "getaglow.co", provenance: "url_provided" },
		]);
		expect(id.socialHandles).toHaveLength(0);
		expect(ctx.job.warnings.map((w) => w.type)).toContain(
			RESOLVE_WARNING.homepageFetchFailed,
		);
	});

	it("absent target brand context: warns, proceeds without positioning", async () => {
		const f = makeFakes({
			brandContext: {
				fetchContext: vi.fn(async (d: string) =>
					d === "getaglow.co" ? null : ctxData(),
				),
			},
		});
		const ctx = runningContext(urlAnchor);
		await make(f).run(ctx);
		expect(ctx.resolvedIdentity?.brandContext).toBeNull();
		expect(ctx.job.warnings.map((w) => w.type)).toContain(
			RESOLVE_WARNING.brandContextAbsent,
		);
	});

	it("a collision context fetch failing: that collision has null context, one aggregate warning", async () => {
		const f = makeFakes({
			brandContext: {
				fetchContext: vi.fn(async (d: string) =>
					d === "aglowair.example" ? null : ctxData(),
				),
			},
			brandSearch: {
				search: vi.fn(async () => [
					{
						brandId: "c1",
						domain: "homeaglow.com",
						name: "HomeAglow",
						relevance: 0.4,
					},
					{
						brandId: "c2",
						domain: "aglowair.example",
						name: "Aglow Air",
						relevance: 0.2,
					},
				]),
			},
		});
		const ctx = runningContext(urlAnchor);
		await make(f).run(ctx);
		const collisions = ctx.resolvedIdentity?.nameCollisions ?? [];
		expect(
			collisions.find((c) => c.domain === "aglowair.example")?.context,
		).toBeNull();
		expect(
			collisions.find((c) => c.domain === "homeaglow.com")?.context,
		).not.toBeNull();
		expect(ctx.job.warnings.map((w) => w.type)).toContain(
			RESOLVE_WARNING.collisionContextFetchFailed,
		);
	});

	it("re-run semantics: company identity comes from the frozen anchor, never re-chosen from search", async () => {
		// brand search returns a different top company; identity name must still come from the anchor's brand.
		const f = makeFakes({
			brand: {
				resolveBrand: vi.fn(async () => ({
					brandId: "target",
					name: "Aglow",
					primaryDomain: "getaglow.co",
				})),
			},
			brandSearch: {
				search: vi.fn(async () => [
					{
						brandId: "other",
						domain: "homeaglow.com",
						name: "HomeAglow",
						relevance: 0.99,
					},
				]),
			},
		});
		const ctx = runningContext(urlAnchor);
		await make(f).run(ctx);
		expect(ctx.resolvedIdentity?.companyName).toBe("Aglow");
	});

	it("structural zero-LLM guarantee: stage takes only the 4 ports + repo (no Anthropic dep)", () => {
		expect(ResolveStage.length).toBe(5); // brandSearch, brand, brandContext, homepage, repo
	});
});
