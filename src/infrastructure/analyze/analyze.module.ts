import Anthropic from "@anthropic-ai/sdk";
import { Module } from "@nestjs/common";
import { tavily } from "@tavily/core";
import {
	ANALYZE_CONFIG,
	assertAnalyzeConfig,
} from "../../application/analyze/analyze-config";
import { CONTENT_EXTRACTION_PORT } from "../../application/analyze/ports/content-extraction.port";
import { FULL_TEXT_ANALYSIS_PORT } from "../../application/analyze/ports/full-text-analysis.port";
import { SNIPPET_JUDGEMENT_PORT } from "../../application/analyze/ports/snippet-judgement.port";
import { type Env, loadEnv } from "../../config/env";
import { ENV } from "../../interface/di-tokens";
import type { AnthropicClient } from "../anthropic/anthropic-structured";
import { FullTextAnalysisAdapter } from "../anthropic/full-text-analysis.adapter";
import { SnippetJudgementAdapter } from "../anthropic/snippet-judgement.adapter";
import {
	TavilyContentExtractionAdapter,
	type TavilyExtractClient,
} from "../tavily/content-extraction.adapter";

/**
 * Wires Analyze's three adapters (two Haiku, one Tavily Extract) + the tuned AnalyzeConfig behind their
 * ports, built from the validated `Env`. Like `SearchModule`, it provides its own module-scoped `ENV`
 * so it is self-contained, and constructs the Anthropic/Tavily clients keyless-safe — both build with an
 * empty key and only fail at call time, which the adapters translate into a Warning-grade value (one
 * ANTHROPIC_API_KEY, one TAVILY_API_KEY shared across the pipeline; "one key, three signals").
 */
@Module({
	exports: [
		ANALYZE_CONFIG,
		CONTENT_EXTRACTION_PORT,
		FULL_TEXT_ANALYSIS_PORT,
		SNIPPET_JUDGEMENT_PORT,
	],
	providers: [
		{ provide: ENV, useFactory: () => loadEnv() },
		{
			inject: [ENV],
			provide: ANALYZE_CONFIG,
			useFactory: (env: Env) =>
				assertAnalyzeConfig({
					extractConcurrency: env.ANALYZE_EXTRACT_CONCURRENCY,
					fullTextTExclude: env.ANALYZE_FULL_TEXT_T_EXCLUDE,
					snippetTExclude: env.ANALYZE_SNIPPET_T_EXCLUDE,
					takeawayMaxLength: env.ANALYZE_TAKEAWAY_MAX_LENGTH,
					tVerified: env.ANALYZE_T_VERIFIED,
				}),
		},
		{
			inject: [ENV],
			provide: SNIPPET_JUDGEMENT_PORT,
			useFactory: (env: Env) =>
				new SnippetJudgementAdapter(
					new Anthropic({
						apiKey: env.ANTHROPIC_API_KEY,
					}) as unknown as AnthropicClient,
					env.ANTHROPIC_HAIKU_MODEL,
					env.ANTHROPIC_ANALYZE_TIMEOUT_MS,
				),
		},
		{
			inject: [ENV],
			provide: FULL_TEXT_ANALYSIS_PORT,
			useFactory: (env: Env) =>
				new FullTextAnalysisAdapter(
					new Anthropic({
						apiKey: env.ANTHROPIC_API_KEY,
					}) as unknown as AnthropicClient,
					env.ANTHROPIC_HAIKU_MODEL,
					env.ANTHROPIC_ANALYZE_TIMEOUT_MS,
					env.ANALYZE_TAKEAWAY_MAX_LENGTH,
				),
		},
		{
			inject: [ENV],
			provide: CONTENT_EXTRACTION_PORT,
			useFactory: (env: Env) =>
				new TavilyContentExtractionAdapter(
					tavily({
						apiKey: env.TAVILY_API_KEY,
					}) as unknown as TavilyExtractClient,
					env.TAVILY_TIMEOUT_MS,
				),
		},
	],
})
export class AnalyzeModule {}
