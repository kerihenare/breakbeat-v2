import { offTopicExclusion } from "../../domain/analyze/exclusion-mapping";
import type { SnippetOutcome } from "../../domain/analyze/extract-gate";
import { ratchet } from "../../domain/analyze/match-score";
import { classifyScore } from "../../domain/analyze/verification-status";
import type { FilterResult } from "../search/ports/result-repository.port";
import type { AnalyzerContext } from "./analyzer-context";
import type { SnippetEvidence } from "./ports/snippet-judgement.port";
import type { WarningTally } from "./warning-tally";

/**
 * Pass 1 — the two cheap snippet judgements on title+snippet+URL only, run concurrently (they share no
 * state). snippet-Classify (1b) writes the provisional Content Type and rides along even into an
 * Excluded row (it never gates). snippet-Verify (1a) writes the interim rung and derives exclude/
 * survive against the LENIENT cutoff (off_topic/"LLM" on exclude); a failed cheap gate survives with
 * no interim rung — it must not Exclude. Never writes verification_status. Returns the Extract-gating
 * outcome plus whether a provisional content_type was written.
 */
export async function snippetGates(
	ctx: AnalyzerContext,
	result: FilterResult,
	tally: WarningTally,
): Promise<{ outcome: SnippetOutcome; typeWritten: boolean }> {
	const evidence: SnippetEvidence = {
		snippet: result.snippet,
		title: result.title,
		url: result.url,
	};
	const [verify, classify] = await Promise.all([
		ctx.snippet.verifySnippet({
			brandContext: ctx.brandContext,
			evidence,
			negativeBoost: ctx.negativeBoost,
		}),
		ctx.snippet.classifySnippet(evidence),
	]);

	let typeWritten = false;
	if ("contentType" in classify) {
		await ctx.repo.setProvisionalContentType(result.id, classify.contentType);
		typeWritten = true;
	} else {
		tally.snippetClassifyFailed += 1;
	}

	return { outcome: await snippetVerify(ctx, result.id, verify), typeWritten };
}

async function snippetVerify(
	ctx: AnalyzerContext,
	resultId: string,
	verify: { interimMatchScore: number } | { failed: true },
): Promise<SnippetOutcome> {
	if ("failed" in verify) {
		return {
			interimScore: Number.NaN,
			kind: "survived",
			provisionalType: null,
		};
	}
	const interim = ratchet("interim", verify.interimMatchScore);
	await ctx.repo.setInterimMatchScore(resultId, interim);
	const cutoffs = {
		tExclude: ctx.config.snippetTExclude, // the LENIENT cost gate
		tVerified: ctx.config.tVerified,
	};
	if (classifyScore(interim, cutoffs).kind === "exclude") {
		const { code, detail } = offTopicExclusion();
		await ctx.repo.recordExclusion(resultId, code, detail);
		return { kind: "excluded" };
	}
	return { interimScore: interim, kind: "survived", provisionalType: null };
}
