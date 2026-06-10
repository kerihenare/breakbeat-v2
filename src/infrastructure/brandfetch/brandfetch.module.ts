import { Module } from "@nestjs/common";
import { BRAND_PORT } from "../../application/resolve/ports/brand.port";
import { BRAND_CONTEXT_PORT } from "../../application/resolve/ports/brand-context.port";
import { BRAND_SEARCH_PORT } from "../../application/resolve/ports/brand-search.port";
import { HOMEPAGE_FETCH_PORT } from "../../application/resolve/ports/homepage-fetch.port";
import { type Env, loadEnv } from "../../config/env";
import { ENV } from "../../interface/di-tokens";
import { HomepageFetchAdapter } from "../homepage/homepage-fetch.adapter";
import { BrandAdapter } from "./brand.adapter";
import { BrandContextAdapter } from "./brand-context.adapter";
import { BrandSearchAdapter } from "./brand-search.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

/**
 * Wires the three BrandFetch adapters + the homepage adapter behind their ports,
 * built from the validated `Env`. Exported so both the worker (Resolve) and the
 * web side (PRD 7 autocomplete reuses BrandSearchPort) consume the same adapters.
 * It provides its own module-scoped `ENV` (mirroring `coreProviders`) so it is
 * self-contained wherever it is imported.
 */
@Module({
	exports: [
		BRAND_SEARCH_PORT,
		BRAND_PORT,
		BRAND_CONTEXT_PORT,
		HOMEPAGE_FETCH_PORT,
	],
	providers: [
		{ provide: ENV, useFactory: () => loadEnv() },
		{
			inject: [ENV],
			provide: BrandfetchHttp,
			useFactory: (env: Env) =>
				new BrandfetchHttp({
					apiKey: env.BRANDFETCH_API_KEY,
					baseUrl: env.BRANDFETCH_BASE_URL,
					timeoutMs: env.BRANDFETCH_TIMEOUT_MS,
				}),
		},
		{
			inject: [BrandfetchHttp],
			provide: BRAND_SEARCH_PORT,
			useFactory: (http: BrandfetchHttp) => new BrandSearchAdapter(http),
		},
		{
			inject: [BrandfetchHttp],
			provide: BRAND_PORT,
			useFactory: (http: BrandfetchHttp) => new BrandAdapter(http),
		},
		{
			inject: [BrandfetchHttp],
			provide: BRAND_CONTEXT_PORT,
			useFactory: (http: BrandfetchHttp) => new BrandContextAdapter(http),
		},
		{
			inject: [ENV],
			provide: HOMEPAGE_FETCH_PORT,
			useFactory: (env: Env) =>
				new HomepageFetchAdapter({ timeoutMs: env.HOMEPAGE_FETCH_TIMEOUT_MS }),
		},
	],
})
export class BrandfetchModule {}
