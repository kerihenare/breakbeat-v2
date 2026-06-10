import { Controller, Get, Inject, Query } from "@nestjs/common";
import {
	BRAND_SEARCH_PORT,
	type BrandSearchPort,
} from "../../application/resolve/ports/brand-search.port";
import type { Env } from "../../config/env";
import { ENV } from "../di-tokens";

/** The input-time autocomplete suggestion shape (a JSON-safe subset of BrandSearchHit). */
export type BrandSuggestion = {
	brandId: string | null;
	name: string;
	domain: string | null;
};

/**
 * The homepage autocomplete feed. Reuses Resolve's already-registered
 * `BrandSearchPort` (the same BrandFetch adapter the Resolve stage uses — no
 * second client, spec story 21). A query shorter than `AUTOCOMPLETE_MIN_CHARS`
 * returns `[]` and never touches the port (no wasted external call); the hits
 * are mapped through verbatim — the UI never re-ranks them.
 */
@Controller()
export class BrandSearchController {
	constructor(
		@Inject(BRAND_SEARCH_PORT) private readonly brandSearch: BrandSearchPort,
		@Inject(ENV) private readonly env: Env,
	) {}

	@Get("brand-search")
	async search(@Query("q") q: string | undefined): Promise<BrandSuggestion[]> {
		const query = (q ?? "").trim();
		if (query.length < this.env.AUTOCOMPLETE_MIN_CHARS) return [];
		const hits = await this.brandSearch.search(query);
		return hits.map((h) => ({
			brandId: h.brandId,
			domain: h.domain,
			name: h.name,
		}));
	}
}
