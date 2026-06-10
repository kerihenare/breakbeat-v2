import Anthropic from "@anthropic-ai/sdk";
import { Module } from "@nestjs/common";
import { SUMMARISE_PORT } from "../../application/summarise/ports/summarise.port";
import {
	SUMMARISE_CONFIG,
	type SummariseConfig,
} from "../../application/summarise/summarise-config";
import { type Env, loadEnv } from "../../config/env";
import { ENV } from "../../interface/di-tokens";
import type { AnthropicClient } from "../anthropic/anthropic-structured";
import { SummariseAdapter } from "../anthropic/summarise.adapter";

/**
 * Wires the Summarise Haiku adapter + the tuned SummariseConfig behind their ports, built from the
 * validated `Env`. Like `AnalyzeModule`, it provides its own module-scoped `ENV` so it is
 * self-contained and constructs the Anthropic client keyless-safe — it builds with an empty key and
 * only fails at call time, which the adapter translates into the typed Warning-grade { ok: false }
 * (one ANTHROPIC_API_KEY shared across the pipeline). Tavily Research API not wired (deferred,
 * ADR 0002 — a future alternative adapter behind the same SUMMARISE_PORT).
 */
@Module({
	exports: [SUMMARISE_CONFIG, SUMMARISE_PORT],
	providers: [
		{ provide: ENV, useFactory: () => loadEnv() },
		{
			inject: [ENV],
			provide: SUMMARISE_CONFIG,
			useFactory: (env: Env): SummariseConfig => ({
				digestMaxLength: env.SUMMARISE_DIGEST_MAX_LENGTH,
				model: env.SUMMARISE_MODEL,
				timeoutMs: env.SUMMARISE_TIMEOUT_MS,
			}),
		},
		{
			inject: [ENV, SUMMARISE_CONFIG],
			provide: SUMMARISE_PORT,
			useFactory: (env: Env, config: SummariseConfig) =>
				new SummariseAdapter(
					new Anthropic({
						apiKey: env.ANTHROPIC_API_KEY,
					}) as unknown as AnthropicClient,
					config,
				),
		},
	],
})
export class SummariseModule {}
