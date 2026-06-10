import { Module } from "@nestjs/common";
import { metrics } from "@opentelemetry/api";
import { AnalyzeStage } from "./application/analyze/analyze.stage";
import type { AnalyzeConfig } from "./application/analyze/analyze-config";
import { ANALYZE_CONFIG } from "./application/analyze/analyze-config";
import type { ContentExtractionPort } from "./application/analyze/ports/content-extraction.port";
import { CONTENT_EXTRACTION_PORT } from "./application/analyze/ports/content-extraction.port";
import type { FullTextAnalysisPort } from "./application/analyze/ports/full-text-analysis.port";
import { FULL_TEXT_ANALYSIS_PORT } from "./application/analyze/ports/full-text-analysis.port";
import type { SnippetJudgementPort } from "./application/analyze/ports/snippet-judgement.port";
import { SNIPPET_JUDGEMENT_PORT } from "./application/analyze/ports/snippet-judgement.port";
import { FilterStage } from "./application/filter/filter.stage";
import type { FilterConfig } from "./application/filter/filter-config";
import { FILTER_CONFIG } from "./application/filter/filter-config";
import { JOB_OBSERVER } from "./application/observability/job-observer.port";
import type { Stage } from "./application/pipeline/stage.port";
import { STAGES } from "./application/pipeline/stage.port";
import { StageRunner } from "./application/pipeline/stage-runner";
import type { Clock } from "./application/ports/clock.port";
import { CLOCK } from "./application/ports/clock.port";
import type { JobEventPublisher } from "./application/ports/job-event-publisher.port";
import { JOB_EVENT_PUBLISHER } from "./application/ports/job-event-publisher.port";
import type { JobRepository } from "./application/ports/job-repository.port";
import { JOB_REPOSITORY } from "./application/ports/job-repository.port";
import type { BrandPort } from "./application/resolve/ports/brand.port";
import { BRAND_PORT } from "./application/resolve/ports/brand.port";
import type { BrandContextPort } from "./application/resolve/ports/brand-context.port";
import { BRAND_CONTEXT_PORT } from "./application/resolve/ports/brand-context.port";
import type { BrandSearchPort } from "./application/resolve/ports/brand-search.port";
import { BRAND_SEARCH_PORT } from "./application/resolve/ports/brand-search.port";
import type { HomepageFetchPort } from "./application/resolve/ports/homepage-fetch.port";
import { HOMEPAGE_FETCH_PORT } from "./application/resolve/ports/homepage-fetch.port";
import type { ResolvedIdentityRepository } from "./application/resolve/ports/resolved-identity-repository.port";
import { RESOLVED_IDENTITY_REPOSITORY } from "./application/resolve/ports/resolved-identity-repository.port";
import { ResolveStage } from "./application/resolve/resolve.stage";
import { RunJobUseCase } from "./application/run-job.usecase";
import type { ResultRepository } from "./application/search/ports/result-repository.port";
import { RESULT_REPOSITORY } from "./application/search/ports/result-repository.port";
import type { TavilySearchPort } from "./application/search/ports/tavily-search.port";
import { TAVILY_SEARCH_PORT } from "./application/search/ports/tavily-search.port";
import type { WebSearchBackstopPort } from "./application/search/ports/web-search-backstop.port";
import { WEB_SEARCH_BACKSTOP_PORT } from "./application/search/ports/web-search-backstop.port";
import { SearchStage } from "./application/search/search.stage";
import type { SearchConfig } from "./application/search/search-config";
import { SEARCH_CONFIG } from "./application/search/search-config";
import type { SummarisePort } from "./application/summarise/ports/summarise.port";
import { SUMMARISE_PORT } from "./application/summarise/ports/summarise.port";
import type { SummaryRepository } from "./application/summarise/ports/summary-repository.port";
import { SUMMARY_REPOSITORY } from "./application/summarise/ports/summary-repository.port";
import { SummariseStage } from "./application/summarise/summarise.stage";
import type { Env } from "./config/env";
import { AnalyzeModule } from "./infrastructure/analyze/analyze.module";
import { BrandfetchModule } from "./infrastructure/brandfetch/brandfetch.module";
import {
	METRICS_REGISTRY,
	MetricsRegistry,
} from "./infrastructure/observability/meter";
import { OtelJobObserver } from "./infrastructure/observability/otel-job-observer";
import { OtelLifecycle } from "./infrastructure/observability/otel-lifecycle";
import { PIPELINE_TRACER_NAME } from "./infrastructure/observability/tracer";
import { TracingStage } from "./infrastructure/observability/tracing-stage";
import type { DatabaseConnection } from "./infrastructure/persistence/database";
import { ResolvedIdentityDrizzleRepository } from "./infrastructure/persistence/resolved-identity.repository";
import { ResultDrizzleRepository } from "./infrastructure/persistence/result.repository";
import { SummaryDrizzleRepository } from "./infrastructure/persistence/summary.repository";
import { SearchModule } from "./infrastructure/search/search.module";
import { SummariseModule } from "./infrastructure/summarise/summarise.module";
import { ConnectionsLifecycle } from "./interface/connections.lifecycle";
import { coreProviders } from "./interface/core.providers";
import {
	DB_CONNECTION,
	ENV,
	RUN_JOB,
	STAGE_RUNNER,
} from "./interface/di-tokens";
import { JobWorkerService } from "./interface/job-worker.service";

/** The worker DI graph: the consumer side + the stage runner (no HTTP surface). */
@Module({
	imports: [BrandfetchModule, SearchModule, AnalyzeModule, SummariseModule],
	providers: [
		...coreProviders,
		{
			// One MetricsRegistry over the global Meter (the started NodeSDK's, or the
			// no-op meter when telemetry is off — so every record-call is safe).
			provide: METRICS_REGISTRY,
			useFactory: () =>
				new MetricsRegistry(metrics.getMeter(PIPELINE_TRACER_NAME)),
		},
		{
			inject: [DB_CONNECTION],
			provide: RESOLVED_IDENTITY_REPOSITORY,
			useFactory: (c: DatabaseConnection) =>
				new ResolvedIdentityDrizzleRepository(c.db),
		},
		{
			inject: [DB_CONNECTION],
			provide: RESULT_REPOSITORY,
			useFactory: (c: DatabaseConnection) => new ResultDrizzleRepository(c.db),
		},
		{
			inject: [DB_CONNECTION],
			provide: SUMMARY_REPOSITORY,
			useFactory: (c: DatabaseConnection) => new SummaryDrizzleRepository(c.db),
		},
		{
			inject: [
				BRAND_SEARCH_PORT,
				BRAND_PORT,
				BRAND_CONTEXT_PORT,
				HOMEPAGE_FETCH_PORT,
				RESOLVED_IDENTITY_REPOSITORY,
			],
			provide: ResolveStage,
			useFactory: (
				brandSearch: BrandSearchPort,
				brand: BrandPort,
				brandContext: BrandContextPort,
				homepage: HomepageFetchPort,
				repo: ResolvedIdentityRepository,
			) => new ResolveStage(brandSearch, brand, brandContext, homepage, repo),
		},
		{
			inject: [
				TAVILY_SEARCH_PORT,
				WEB_SEARCH_BACKSTOP_PORT,
				RESULT_REPOSITORY,
				SEARCH_CONFIG,
				CLOCK,
			],
			provide: SearchStage,
			useFactory: (
				tavily: TavilySearchPort,
				backstop: WebSearchBackstopPort,
				repo: ResultRepository,
				config: SearchConfig,
				clock: Clock,
			) => new SearchStage(tavily, backstop, repo, config, clock),
		},
		{
			inject: [ENV],
			// Filter's deterministic knobs (PRD 4). Like SEARCH_CONFIG, built from the
			// validated Env with the documented Aglow-tuned defaults.
			provide: FILTER_CONFIG,
			useFactory: (env: Env): FilterConfig => ({
				collapseWindowDays: env.FILTER_COLLAPSE_WINDOW_DAYS,
				horizonMonths: env.FILTER_HORIZON_MONTHS,
				minClusterDomains: env.FILTER_MIN_CLUSTER_DOMAINS,
				minDistinctiveTokens: env.FILTER_MIN_DISTINCTIVE_TOKENS,
			}),
		},
		{
			inject: [RESULT_REPOSITORY, FILTER_CONFIG, CLOCK],
			// PRD 4: reuses the already-wired Result repository — Filter has no new
			// outbound adapter or client. Reads `ctx.resolvedIdentity`, never re-derives.
			provide: FilterStage,
			useFactory: (
				repo: ResultRepository,
				config: FilterConfig,
				clock: Clock,
			) => new FilterStage(repo, config, clock),
		},
		{
			inject: [
				SNIPPET_JUDGEMENT_PORT,
				CONTENT_EXTRACTION_PORT,
				FULL_TEXT_ANALYSIS_PORT,
				RESULT_REPOSITORY,
				ANALYZE_CONFIG,
			],
			// PRD 5: Verify / Classify / Enhance (fused, ADR 0003). Reuses the existing
			// Result repository (Search/Filter wired it) and the Anthropic/Tavily clients
			// AnalyzeModule wired; reads `ctx.resolvedIdentity`, never re-derives.
			provide: AnalyzeStage,
			useFactory: (
				snippet: SnippetJudgementPort,
				extraction: ContentExtractionPort,
				fullText: FullTextAnalysisPort,
				repo: ResultRepository,
				config: AnalyzeConfig,
			) => new AnalyzeStage(snippet, extraction, fullText, repo, config),
		},
		{
			inject: [SUMMARISE_PORT, SUMMARY_REPOSITORY, RESULT_REPOSITORY],
			// PRD 6: Summarise (the one-per-Job Job-level digest). Reuses the existing
			// Result repository (Search/Filter wired it) for `findIncludedForSummary` and
			// the Anthropic client SummariseModule wired; reads `ctx.resolvedIdentity`.
			provide: SummariseStage,
			useFactory: (
				port: SummarisePort,
				summaries: SummaryRepository,
				repo: ResultRepository,
			) => new SummariseStage(port, summaries, repo),
		},
		{
			inject: [
				ResolveStage,
				SearchStage,
				FilterStage,
				AnalyzeStage,
				SummariseStage,
				METRICS_REGISTRY,
			],
			// PRD 2 → 3 → 4 → 5 → 6: Resolve first, Search second, Filter third, Analyze
			// fourth, Summarise fifth / last (ADR 0002/0004). The runner threads one
			// RunContext; each stage reads the ResolvedIdentity Resolve set. Analyze runs
			// over Filter's surviving `included` Results; Summarise digests them. Each
			// stage is wrapped in TracingStage so it gets a Stage Span + stage.duration.
			provide: STAGES,
			useFactory: (
				resolve: ResolveStage,
				search: SearchStage,
				filter: FilterStage,
				analyze: AnalyzeStage,
				summarise: SummariseStage,
				metricsRegistry: MetricsRegistry,
			): Stage[] =>
				[resolve, search, filter, analyze, summarise].map(
					(stage) =>
						new TracingStage(stage, metricsRegistry, "breakbeat-worker"),
				),
		},
		{
			inject: [STAGES],
			provide: STAGE_RUNNER,
			useFactory: (stages: Stage[]) => new StageRunner(stages),
		},
		{
			// Maps a Job's terminal state to the job.pipeline span status + the job
			// metrics, and feeds failures to Bugsink (no-op when telemetry is off).
			inject: [METRICS_REGISTRY],
			provide: JOB_OBSERVER,
			useFactory: (metricsRegistry: MetricsRegistry) =>
				new OtelJobObserver(metricsRegistry, "breakbeat-worker"),
		},
		{
			inject: [
				JOB_REPOSITORY,
				JOB_EVENT_PUBLISHER,
				CLOCK,
				STAGE_RUNNER,
				JOB_OBSERVER,
			],
			provide: RUN_JOB,
			useFactory: (
				jobs: JobRepository,
				publisher: JobEventPublisher,
				clock: Clock,
				runner: StageRunner,
				observer: OtelJobObserver,
			) => new RunJobUseCase(jobs, publisher, clock, runner, observer),
		},
		JobWorkerService,
		ConnectionsLifecycle,
		OtelLifecycle,
	],
})
export class AppWorkerModule {}
