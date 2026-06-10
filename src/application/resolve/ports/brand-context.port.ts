import type { BrandContext } from "../../../domain/resolve/brand-context";

/** Domain-keyed Brand Context — used for the target and once per collision. */
export interface BrandContextPort {
	// null on absent/failure — never throws.
	fetchContext(domain: string): Promise<BrandContext | null>;
}

export const BRAND_CONTEXT_PORT = Symbol("BrandContextPort");
