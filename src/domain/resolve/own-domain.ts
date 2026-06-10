/**
 * OwnDomain — a domain the Resolved Identity owns, tagged with how it was
 * obtained. `url_provided` = a host the user pasted (kept even when the homepage
 * fetch fails); `brand_derived` = the primary domain the Brand port resolved
 * from a brand-id anchor.
 */
export type DomainProvenance = "url_provided" | "brand_derived";

export type OwnDomain = {
	readonly domain: string;
	readonly provenance: DomainProvenance;
};
