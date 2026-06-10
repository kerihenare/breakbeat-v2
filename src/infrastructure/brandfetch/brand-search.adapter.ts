import { z } from "zod";
import type {
	BrandSearchHit,
	BrandSearchPort,
} from "../../application/resolve/ports/brand-search.port";
import type { BrandfetchHttp } from "./brandfetch.http";

const hitSchema = z
	.object({
		brandId: z.string().nullish(),
		domain: z.string().nullish(),
		name: z.string(),
		score: z.number().nullish(),
	})
	.passthrough();
const responseSchema = z.array(hitSchema);

/**
 * BrandSearchPort over `GET /v2/search/{query}`. Maps the documented subset
 * (brandId/name/domain/score) and tolerates unknown fields. Empty array on no
 * results, transport failure, or a payload that fails to parse — never throws.
 */
export class BrandSearchAdapter implements BrandSearchPort {
	constructor(private readonly http: BrandfetchHttp) {}

	async search(name: string): Promise<BrandSearchHit[]> {
		const raw = await this.http.getJson(`/search/${encodeURIComponent(name)}`);
		if (raw === null) return [];
		const parsed = responseSchema.safeParse(raw);
		if (!parsed.success) return [];
		return parsed.data.map((h) => ({
			brandId: h.brandId ?? null,
			domain: h.domain ?? null,
			name: h.name,
			relevance: h.score ?? null,
		}));
	}
}
