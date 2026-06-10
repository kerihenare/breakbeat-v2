export type CanonicalBrand = {
	brandId: string | null;
	name: string | null;
	primaryDomain: string | null;
};

/** Resolves the canonical brand for the anchor (by domain or brandId). */
export interface BrandPort {
	// null on absent/failure — never throws.
	resolveBrand(ref: {
		domain?: string;
		brandId?: string;
	}): Promise<CanonicalBrand | null>;
}

export const BRAND_PORT = Symbol("BrandPort");
