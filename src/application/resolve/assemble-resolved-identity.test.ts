import { describe, expect, it } from "vitest";
import { RESOLVE_WARNING } from "../../domain/resolve/resolve-warnings";
import {
	type AssemblyInput,
	assembleResolvedIdentity,
} from "./assemble-resolved-identity";

const base: AssemblyInput = {
	anchorDomainForName: "getaglow.co",
	anchorName: null,
	brandContext: {
		description: "d",
		mission: null,
		productsAndServices: [],
		tagline: null,
		tags: [],
		targetAudienceSegments: [],
		valueProposition: "vp",
	},
	canonicalBrandName: "Aglow",
	collisions: [
		{
			brandId: "x",
			context: null,
			domain: "aglow.org",
			name: "Aglow International",
		},
	],
	flags: {
		collisionContextFailures: 0,
		homepageFetchFailed: false,
		homepageUnresolved: false,
		targetInferred: false,
	},
	handles: [],
	homepageConfirmedName: null,
	ownDomain: { domain: "getaglow.co", provenance: "url_provided" },
};

describe("assembleResolvedIdentity", () => {
	it("prefers the canonical brand name, then homepage, then anchor name, then domain", () => {
		expect(assembleResolvedIdentity(base).identity.companyName).toBe("Aglow");
		expect(
			assembleResolvedIdentity({
				...base,
				canonicalBrandName: null,
				homepageConfirmedName: "Aglow HP",
			}).identity.companyName,
		).toBe("Aglow HP");
		expect(
			assembleResolvedIdentity({
				...base,
				anchorName: "Aglow Name",
				canonicalBrandName: null,
				homepageConfirmedName: null,
			}).identity.companyName,
		).toBe("Aglow Name");
		expect(
			assembleResolvedIdentity({
				...base,
				anchorName: null,
				canonicalBrandName: null,
				homepageConfirmedName: null,
			}).identity.companyName,
		).toBe("getaglow.co");
	});

	it("derives the negative boost from the collisions", () => {
		const out = assembleResolvedIdentity(base);
		expect(out.identity.negativeBoost).toContain(
			"Aglow International (aglow.org)",
		);
	});

	it("emits the matching warnings from the flags", () => {
		const out = assembleResolvedIdentity({
			...base,
			brandContext: null,
			flags: {
				collisionContextFailures: 2,
				homepageFetchFailed: false,
				homepageUnresolved: true,
				targetInferred: true,
			},
		});
		const types = out.warnings.map((w) => w.type).sort();
		expect(types).toEqual(
			[
				RESOLVE_WARNING.brandContextAbsent,
				RESOLVE_WARNING.collisionContextFetchFailed,
				RESOLVE_WARNING.collisionTargetInferred,
				RESOLVE_WARNING.homepageUnresolved,
			].sort(),
		);
	});

	it("includes the own domain when present and omits it when null", () => {
		expect(assembleResolvedIdentity(base).identity.ownDomains).toHaveLength(1);
		expect(
			assembleResolvedIdentity({ ...base, ownDomain: null }).identity
				.ownDomains,
		).toHaveLength(0);
	});
});
