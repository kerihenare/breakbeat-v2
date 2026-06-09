/**
 * CompanyAnchor — the durable, frozen disambiguation chosen ONCE at input
 * (CONTEXT.md "Job" relationships; PRD 1; Foundation design §Domain).
 *
 * It is one of two shapes:
 *  - `disambiguated`: a domain and/or brand-id the user picked. Carries
 *    provenance (`picked` | `url_provided`) so later stages and Warnings can
 *    reason about how much the user already gave us.
 *  - `name_only`: the explicit degraded fallback.
 *
 * The anchor is immutable for the life of the Job — re-runs copy it verbatim
 * into a new Job and NEVER re-derive which company it is. It is deliberately
 * distinct from the Resolved Identity (derived per-run by the Resolve stage):
 * conflating them reintroduces the disambiguation bug.
 */

export type Provenance = "picked" | "url_provided" | "name_only";

export type CompanyAnchor =
	| {
			readonly kind: "disambiguated";
			readonly domain: string | null;
			readonly brandId: string | null;
			readonly provenance: Exclude<Provenance, "name_only">;
	  }
	| {
			readonly kind: "name_only";
			readonly name: string;
			readonly provenance: "name_only";
	  };

export class InvalidAnchorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidAnchorError";
	}
}

/**
 * Build a disambiguated anchor. At least one of `domain` / `brandId` must be
 * present (the Zod input layer guarantees this; the domain enforces it
 * defensively so an invalid anchor can never be constructed).
 */
export function disambiguatedAnchor(params: {
	domain?: string | null;
	brandId?: string | null;
	provenance: Exclude<Provenance, "name_only">;
}): CompanyAnchor {
	const domain = normalize(params.domain);
	const brandId = normalize(params.brandId);
	if (domain === null && brandId === null) {
		throw new InvalidAnchorError(
			"A disambiguated anchor needs at least one of domain or brandId",
		);
	}
	return Object.freeze({
		brandId,
		domain,
		kind: "disambiguated" as const,
		provenance: params.provenance,
	});
}

/** Build the explicit degraded name-only fallback anchor. */
export function nameOnlyAnchor(name: string): CompanyAnchor {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		throw new InvalidAnchorError("A name-only anchor needs a non-empty name");
	}
	return Object.freeze({
		kind: "name_only" as const,
		name: trimmed,
		provenance: "name_only" as const,
	});
}

function normalize(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}
