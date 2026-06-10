/**
 * BrandContext — the target's positioning (the seven fields Verify leans on).
 * A CollisionContext is the same shape: a Brand Context fetched for a
 * look-alike's domain.
 */
export type BrandContext = {
	readonly tagline: string | null;
	readonly mission: string | null;
	readonly description: string | null;
	readonly tags: readonly string[];
	readonly valueProposition: string | null;
	readonly targetAudienceSegments: readonly string[];
	readonly productsAndServices: readonly string[];
};

// A collision's mini brand-context has the same shape as the target's.
export type CollisionContext = BrandContext;
