import type { CompanyAnchor } from "../../domain/job/company-anchor";
import type { OwnDomain } from "../../domain/resolve/own-domain";
import type { BrandPort, CanonicalBrand } from "./ports/brand.port";

export type AnchorResolution = {
	domain: string | null;
	ownDomain: OwnDomain | null;
	canonicalBrand: CanonicalBrand | null;
	// name_only carries a name; disambiguated does not.
	anchorName: string | null;
};

/**
 * Anchor resolution order (PRD): (1) anchor domain; (2) brand-id → Brand port →
 * primary domain; (3) neither → genuine name-only degraded path. A disambiguated
 * brand-id is a STRONG anchor and gets the full treatment — never treated as
 * degraded just because it stored an id.
 */
export async function resolveAnchorDomain(
	anchor: CompanyAnchor,
	brandPort: BrandPort,
): Promise<AnchorResolution> {
	if (anchor.kind === "name_only") {
		// No domain/brandId to look up; the adapter returns null for an empty ref.
		const canonicalBrand = await brandPort.resolveBrand({}).catch(() => null);
		return {
			anchorName: anchor.name,
			canonicalBrand,
			domain: null,
			ownDomain: null,
		};
	}

	if (anchor.domain) {
		const canonicalBrand = await brandPort.resolveBrand({
			domain: anchor.domain,
		});
		return {
			anchorName: null,
			canonicalBrand,
			domain: anchor.domain,
			ownDomain: { domain: anchor.domain, provenance: "url_provided" },
		};
	}

	if (anchor.brandId) {
		const canonicalBrand = await brandPort.resolveBrand({
			brandId: anchor.brandId,
		});
		const domain = canonicalBrand?.primaryDomain ?? null;
		return {
			anchorName: null,
			canonicalBrand,
			domain,
			ownDomain: domain ? { domain, provenance: "brand_derived" } : null,
		};
	}

	return {
		anchorName: null,
		canonicalBrand: null,
		domain: null,
		ownDomain: null,
	};
}
