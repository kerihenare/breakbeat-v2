import { z } from "zod";
import type { BrandContextPort } from "../../application/resolve/ports/brand-context.port";
import type { BrandContext } from "../../domain/resolve/brand-context";
import type { BrandfetchHttp } from "./brandfetch.http";

const contextSchema = z
	.object({
		description: z.string().nullish(),
		mission: z.string().nullish(),
		productsAndServices: z.array(z.string()).nullish(),
		tagline: z.string().nullish(),
		tags: z.array(z.string()).nullish(),
		targetAudienceSegments: z.array(z.string()).nullish(),
		valueProposition: z.string().nullish(),
	})
	.passthrough();

/**
 * BrandContextPort over `GET /v2/context/{domain}`. Maps the seven positioning
 * fields (missing ones default to null/[]); used for both the target and each
 * collision. null on transport/parse failure — never throws.
 */
export class BrandContextAdapter implements BrandContextPort {
	constructor(private readonly http: BrandfetchHttp) {}

	async fetchContext(domain: string): Promise<BrandContext | null> {
		const raw = await this.http.getJson(
			`/context/${encodeURIComponent(domain)}`,
		);
		if (raw === null) return null;
		const parsed = contextSchema.safeParse(raw);
		if (!parsed.success) return null;
		const d = parsed.data;
		return {
			description: d.description ?? null,
			mission: d.mission ?? null,
			productsAndServices: d.productsAndServices ?? [],
			tagline: d.tagline ?? null,
			tags: d.tags ?? [],
			targetAudienceSegments: d.targetAudienceSegments ?? [],
			valueProposition: d.valueProposition ?? null,
		};
	}
}
