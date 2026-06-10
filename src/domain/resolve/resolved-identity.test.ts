import { describe, expect, it } from "vitest";
import type { BrandContext } from "./brand-context";
import type { NameCollision } from "./name-collision";
import type { OwnDomain } from "./own-domain";
import { ResolvedIdentity } from "./resolved-identity";
import type { SocialHandle } from "./social-handle";

const brandContext: BrandContext = {
	description: "A Sydney beauty-membership startup",
	mission: null,
	productsAndServices: ["membership"],
	tagline: "Beauty membership",
	tags: ["beauty"],
	targetAudienceSegments: ["consumers"],
	valueProposition: "Membership beauty",
};

describe("ResolvedIdentity.assemble", () => {
	it("composes name, own domains, handles, context, collisions and negative boost", () => {
		const ownDomains: OwnDomain[] = [
			{ domain: "getaglow.co", provenance: "url_provided" },
		];
		const handles: SocialHandle[] = [
			{ handle: "getaglow", platform: "x", url: "https://x.com/getaglow" },
		];
		const collisions: NameCollision[] = [
			{
				brandId: "b1",
				context: null,
				domain: "aglow.org",
				name: "Aglow International",
			},
		];

		const id = ResolvedIdentity.assemble({
			brandContext,
			companyName: "Aglow",
			nameCollisions: collisions,
			negativeBoost: "Known look-alikes ...",
			ownDomains,
			socialHandles: handles,
		});

		expect(id.companyName).toBe("Aglow");
		expect(id.ownDomains).toEqual(ownDomains);
		expect(id.socialHandles).toEqual(handles);
		expect(id.brandContext).toEqual(brandContext);
		expect(id.nameCollisions).toEqual(collisions);
		expect(id.negativeBoost).toBe("Known look-alikes ...");
	});

	it("freezes its arrays so later stages cannot mutate the anchor", () => {
		const id = ResolvedIdentity.assemble({
			brandContext: null,
			companyName: "Aglow",
			nameCollisions: [],
			negativeBoost: "",
			ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
			socialHandles: [],
		});
		expect(() =>
			(id.ownDomains as OwnDomain[]).push({
				domain: "x.com",
				provenance: "brand_derived",
			}),
		).toThrow();
		expect(Object.isFrozen(id)).toBe(true);
	});

	it("rejects a blank company name (the anchor always yields at least a name)", () => {
		expect(() =>
			ResolvedIdentity.assemble({
				brandContext: null,
				companyName: "  ",
				nameCollisions: [],
				negativeBoost: "",
				ownDomains: [],
				socialHandles: [],
			}),
		).toThrow(/company name/i);
	});
});
