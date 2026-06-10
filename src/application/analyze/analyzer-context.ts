import type { BrandContext } from "../../domain/resolve/brand-context";
import type { ResultRepository } from "../search/ports/result-repository.port";
import type { AnalyzeConfig } from "./analyze-config";
import type { ContentExtractionPort } from "./ports/content-extraction.port";
import type { FullTextAnalysisPort } from "./ports/full-text-analysis.port";
import type { SnippetJudgementPort } from "./ports/snippet-judgement.port";

/**
 * The Job-scoped context the two analyze passes share: the three LLM/Extract ports, the repository,
 * the cutoffs (lenient snippet vs strict full-text), and the resolved positive/negative signals. Built
 * once per Job by the stage and threaded (read-only) into each per-Result pass — one object, not a
 * separate Deps type per pass, so the orchestration stays cohesive and operand-light.
 */
export type AnalyzerContext = {
	readonly snippet: SnippetJudgementPort;
	readonly extraction: ContentExtractionPort;
	readonly fullText: FullTextAnalysisPort;
	readonly repo: ResultRepository;
	readonly config: AnalyzeConfig;
	readonly brandContext: BrandContext | null;
	readonly negativeBoost: string;
};
