import { analyzeWarnings } from "../../domain/analyze/analyze-warnings";
import type { RunContext } from "../pipeline/run-context";
import type { Stage } from "../pipeline/stage.port";
import type { ResultRepository } from "../search/ports/result-repository.port";
import type { AnalyzeConfig } from "./analyze-config";
import type { AnalyzerContext } from "./analyzer-context";
import type { ContentExtractionPort } from "./ports/content-extraction.port";
import type { FullTextAnalysisPort } from "./ports/full-text-analysis.port";
import type { SnippetJudgementPort } from "./ports/snippet-judgement.port";
import { analyzeResult } from "./result-analyzer";
import { emptyTally, tallyWarnings } from "./warning-tally";

/**
 * The fourth pipeline stage (Verify / Classify / Enhance, fused per ADR 0003). Reads the `included`
 * pool and the ResolvedIdentity, then runs each Result through the two-pass {@link ResultAnalyzer}
 * (snippet gates → Extract → one fused Haiku call) with bounded concurrency. The only Exclusion it
 * writes is `off_topic`/"LLM" (the look-alike rejection). Every external-call failure is a per-Result
 * Warning, never a throw — the stage never fails the Job.
 */
export class AnalyzeStage implements Stage {
	readonly name = "analyze";

	constructor(
		private readonly snippet: SnippetJudgementPort,
		private readonly extraction: ContentExtractionPort,
		private readonly fullText: FullTextAnalysisPort,
		private readonly repo: ResultRepository,
		private readonly config: AnalyzeConfig,
	) {}

	async run(ctx: RunContext): Promise<void> {
		const identity = ctx.resolvedIdentity;
		if (identity === undefined) {
			// Programming/ordering fault: Resolve must run first. The runner routes this to `fail`.
			throw new Error(
				"AnalyzeStage requires a ResolvedIdentity (Resolve must run first)",
			);
		}
		if (identity.brandContext === null) {
			ctx.recordWarning(analyzeWarnings.noBrandContext());
		}

		const analyzerCtx: AnalyzerContext = {
			brandContext: identity.brandContext,
			config: this.config,
			extraction: this.extraction,
			fullText: this.fullText,
			negativeBoost: identity.negativeBoost,
			repo: this.repo,
			snippet: this.snippet,
		};
		const pool = await this.repo.findIncluded(ctx.job.id);
		const tally = emptyTally();
		let anyContentTypeWritten = false;

		await this.forEachBounded(
			pool,
			this.config.extractConcurrency,
			async (r) => {
				if (await analyzeResult(analyzerCtx, r, tally))
					anyContentTypeWritten = true;
			},
		);

		for (const warning of tallyWarnings(tally)) ctx.recordWarning(warning);
		// Total-Classify-failure roll-up: a non-empty pool that produced no content_type at all.
		if (pool.length > 0 && !anyContentTypeWritten) {
			ctx.recordWarning(analyzeWarnings.classifyTotallyFailed());
		}
	}

	/** Bounded-concurrency worker pool over the included list (never an unbounded Promise.all). */
	private async forEachBounded<T>(
		items: readonly T[],
		limit: number,
		work: (item: T) => Promise<void>,
	): Promise<void> {
		let cursor = 0;
		const runners = Array.from(
			{ length: Math.min(limit, items.length) },
			async () => {
				while (cursor < items.length) {
					const item = items[cursor++];
					await work(item);
				}
			},
		);
		await Promise.all(runners);
	}
}
