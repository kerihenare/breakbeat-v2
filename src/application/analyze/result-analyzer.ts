import { survivedSnippetGates } from "../../domain/analyze/extract-gate";
import type { FilterResult } from "../search/ports/result-repository.port";
import type { AnalyzerContext } from "./analyzer-context";
import { fullTextPass } from "./full-text-pass";
import { snippetGates } from "./snippet-pass";
import type { WarningTally } from "./warning-tally";

/**
 * Runs one Result through the two-pass pipeline (Verify / Classify / Enhance, fused per ADR 0003): the
 * cheap snippet gates (Pass 1) decide the Extract gate, and survivors flow into the fused full-text
 * pass (Pass 2). It reads the shared {@link AnalyzerContext}, mutates the caller's `WarningTally`
 * (counts only), and returns whether a content_type was written. No external-call failure escapes as a
 * throw. An Excluded-at-snippet Result is never Extracted (the cost gate).
 */
export async function analyzeResult(
	ctx: AnalyzerContext,
	result: FilterResult,
	tally: WarningTally,
): Promise<boolean> {
	const { outcome, typeWritten } = await snippetGates(ctx, result, tally);
	if (!survivedSnippetGates(outcome)) return typeWritten; // Excluded → never Extracted (cost gate)
	const fullTextTyped = await fullTextPass(ctx, result.id, result.url, tally);
	return fullTextTyped || typeWritten;
}
