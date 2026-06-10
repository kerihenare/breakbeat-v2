import type { FusedAnalysis } from "../../../domain/analyze/fused-analysis";
import type { BrandContext } from "../../../domain/resolve/brand-context";

export type FullTextAnalysisInput = {
	readonly fullText: string;
	readonly brandContext: BrandContext | null;
	readonly negativeBoost: string;
};

/** The ONE fused Haiku call per Extracted Result (ADR 0003), Zod-validated. */
export interface FullTextAnalysisPort {
	/** Returns the parsed, Zod-validated FusedAnalysis; a malformed/schema-violating response → { failed: true } (never an unvalidated object). */
	analyze(
		input: FullTextAnalysisInput,
	): Promise<FusedAnalysis | { failed: true }>;
}

export const FULL_TEXT_ANALYSIS_PORT = Symbol("FullTextAnalysisPort");
