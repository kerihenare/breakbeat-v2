export type BrandSearchHit = {
	brandId: string | null;
	name: string;
	domain: string | null;
	// BrandFetch's ranking, used to pick the top hit for name-only inference.
	relevance: number | null;
};

/** Discovers Name Collisions for a company name. Shared with PRD 7 input-time autocomplete. */
export interface BrandSearchPort {
	// [] on empty/failure — never throws.
	search(name: string): Promise<BrandSearchHit[]>;
}

export const BRAND_SEARCH_PORT = Symbol("BrandSearchPort");
