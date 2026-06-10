import { analyzeWarnings } from "../../domain/analyze/analyze-warnings";
import type { Warning } from "../../domain/job/warning";

/** Mutable per-Job tallies the shell rolls up into one Warning per kind (anti-echo: counts only). */
export type WarningTally = {
	extractFailed: number;
	snippetClassifyFailed: number;
	fullTextClassifyFailed: number;
	enhanceFailed: number;
};

export const emptyTally = (): WarningTally => ({
	enhanceFailed: 0,
	extractFailed: 0,
	fullTextClassifyFailed: 0,
	snippetClassifyFailed: 0,
});

/** The per-kind aggregated Warnings (one per kind carrying a count, never one per Result). */
export function tallyWarnings(tally: WarningTally): Warning[] {
	const warnings: Warning[] = [];
	if (tally.extractFailed > 0) {
		warnings.push(analyzeWarnings.extractFailed(tally.extractFailed));
	}
	if (tally.snippetClassifyFailed > 0) {
		warnings.push(
			analyzeWarnings.snippetClassifyFailed(tally.snippetClassifyFailed),
		);
	}
	if (tally.fullTextClassifyFailed > 0) {
		warnings.push(
			analyzeWarnings.fullTextClassifyFailed(tally.fullTextClassifyFailed),
		);
	}
	if (tally.enhanceFailed > 0) {
		warnings.push(analyzeWarnings.enhanceFailed(tally.enhanceFailed));
	}
	return warnings;
}
