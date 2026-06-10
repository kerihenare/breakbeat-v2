import { z } from "zod";
import type {
	BrandPort,
	CanonicalBrand,
} from "../../application/resolve/ports/brand.port";
import type { BrandfetchHttp } from "./brandfetch.http";

const brandSchema = z
	.object({
		domain: z.string().nullish(),
		id: z.string().nullish(),
		name: z.string().nullish(),
	})
	.passthrough();

/**
 * BrandPort over `GET /v2/brands/{idOrDomain}`. Resolves the canonical brand
 * (id, name, primary domain) for a domain or brandId; null when no key is given
 * or on transport/parse failure — never throws.
 */
export class BrandAdapter implements BrandPort {
	constructor(private readonly http: BrandfetchHttp) {}

	async resolveBrand(ref: {
		domain?: string;
		brandId?: string;
	}): Promise<CanonicalBrand | null> {
		const key = ref.domain ?? ref.brandId;
		if (!key) return null;
		const raw = await this.http.getJson(`/brands/${encodeURIComponent(key)}`);
		if (raw === null) return null;
		const parsed = brandSchema.safeParse(raw);
		if (!parsed.success) return null;
		return {
			brandId: parsed.data.id ?? null,
			name: parsed.data.name ?? null,
			primaryDomain: parsed.data.domain ?? null,
		};
	}
}
