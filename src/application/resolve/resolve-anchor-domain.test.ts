import { describe, expect, it, vi } from "vitest";
import type { CompanyAnchor } from "../../domain/job/company-anchor";
import type { BrandPort } from "./ports/brand.port";
import { resolveAnchorDomain } from "./resolve-anchor-domain";

const fakeBrandPort = (domain: string | null): BrandPort => ({
	resolveBrand: vi.fn(async () => ({
		brandId: "b1",
		name: "Aglow",
		primaryDomain: domain,
	})),
});

describe("resolveAnchorDomain", () => {
	it("uses the anchor domain directly with url_provided provenance", async () => {
		const anchor: CompanyAnchor = {
			brandId: null,
			domain: "getaglow.co",
			kind: "disambiguated",
			provenance: "url_provided",
		};
		const brandPort = fakeBrandPort("getaglow.co");
		const out = await resolveAnchorDomain(anchor, brandPort);
		expect(out.domain).toBe("getaglow.co");
		expect(out.ownDomain).toEqual({
			domain: "getaglow.co",
			provenance: "url_provided",
		});
		expect(out.canonicalBrand?.brandId).toBe("b1"); // still resolves the brand for de-self + name
	});

	it("resolves a brand-id-only anchor to a domain via the Brand port (brand_derived)", async () => {
		const anchor: CompanyAnchor = {
			brandId: "b1",
			domain: null,
			kind: "disambiguated",
			provenance: "picked",
		};
		const out = await resolveAnchorDomain(anchor, fakeBrandPort("getaglow.co"));
		expect(out.domain).toBe("getaglow.co");
		expect(out.ownDomain).toEqual({
			domain: "getaglow.co",
			provenance: "brand_derived",
		});
	});

	it("returns no domain for a name-only anchor (genuine degraded trigger)", async () => {
		const anchor: CompanyAnchor = {
			kind: "name_only",
			name: "Aglow",
			provenance: "name_only",
		};
		const out = await resolveAnchorDomain(anchor, fakeBrandPort(null));
		expect(out.domain).toBeNull();
		expect(out.ownDomain).toBeNull();
	});

	it("returns no domain when a brand-id anchor resolves no primary domain", async () => {
		const anchor: CompanyAnchor = {
			brandId: "b1",
			domain: null,
			kind: "disambiguated",
			provenance: "picked",
		};
		const out = await resolveAnchorDomain(anchor, fakeBrandPort(null));
		expect(out.domain).toBeNull();
		expect(out.ownDomain).toBeNull();
	});
});
