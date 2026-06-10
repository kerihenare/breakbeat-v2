import Anthropic from "@anthropic-ai/sdk";
import { Module } from "@nestjs/common";
import { tavily } from "@tavily/core";
import { TAVILY_SEARCH_PORT } from "../../application/search/ports/tavily-search.port";
import { WEB_SEARCH_BACKSTOP_PORT } from "../../application/search/ports/web-search-backstop.port";
import { SEARCH_CONFIG } from "../../application/search/search-config";
import { type Env, loadEnv } from "../../config/env";
import { ENV } from "../../interface/di-tokens";
import {
	type AnthropicClient,
	WebSearchBackstopAdapter,
} from "../anthropic/web-search-backstop.adapter";
import {
	type TavilyClient,
	TavilySearchAdapter,
} from "../tavily/tavily-search.adapter";

/**
 * Wires Search's two source adapters + the tuned SearchConfig behind their ports,
 * built from the validated `Env`. The Result repository is wired in the worker
 * module (it needs the shared DB connection). Exported so the worker consumes the
 * same adapters; like `BrandfetchModule` it provides its own module-scoped `ENV`
 * so it is self-contained. The app boots keyless — `tavily({ apiKey })` and
 * `new Anthropic({ apiKey })` both construct with an empty key and only fail at
 * call time, which the adapters translate into a Warning-grade `{ failed: true }`.
 * The Anthropic client is a Search dependency only; Resolve has none (ADR 0001).
 */
@Module({
	exports: [TAVILY_SEARCH_PORT, WEB_SEARCH_BACKSTOP_PORT, SEARCH_CONFIG],
	providers: [
		{ provide: ENV, useFactory: () => loadEnv() },
		{
			inject: [ENV],
			provide: TAVILY_SEARCH_PORT,
			useFactory: (env: Env) =>
				new TavilySearchAdapter(
					tavily({ apiKey: env.TAVILY_API_KEY }) as unknown as TavilyClient,
				),
		},
		{
			inject: [ENV],
			provide: WEB_SEARCH_BACKSTOP_PORT,
			useFactory: (env: Env) =>
				new WebSearchBackstopAdapter(
					new Anthropic({
						apiKey: env.ANTHROPIC_API_KEY,
					}) as unknown as AnthropicClient,
					env.ANTHROPIC_BACKSTOP_MODEL,
				),
		},
		{
			inject: [ENV],
			provide: SEARCH_CONFIG,
			useFactory: (env: Env) => ({
				horizonMonths: 36,
				lowYieldThreshold: env.SEARCH_LOW_YIELD_THRESHOLD,
				windowMonths: 12,
			}),
		},
	],
})
export class SearchModule {}
