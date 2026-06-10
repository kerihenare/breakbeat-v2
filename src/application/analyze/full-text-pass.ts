import { offTopicExclusion } from "../../domain/analyze/exclusion-mapping";
import { decideFullText } from "../../domain/analyze/full-text-verdict";
import type { AnalyzerContext } from "./analyzer-context";
import type { WarningTally } from "./warning-tally";

/**
 * Pass 2 — Extract (Tavily, server-side), then the ONE fused Haiku call. Persists the Extracted full
 * text on success (display-only, PRD 07). Applies the STRICT full-text cutoff via the pure domain
 * decision: exclude → off_topic (the Verification flip, no Enhance write); else one
 * applyFullTextOutcome. Every external failure is a benign value → a Warning, never a throw. Returns
 * true iff a content_type was written for this Result on the full-text pass.
 */
export async function fullTextPass(
	ctx: AnalyzerContext,
	resultId: string,
	url: string,
	tally: WarningTally,
): Promise<boolean> {
	const extracted = await ctx.extraction.extract(url);
	if (extracted.kind === "extractionFailure") {
		tally.extractFailed += 1; // stays included; interim + provisional type kept; status + extracted_content NULL
		return false;
	}
	await ctx.repo.setExtractedContent(resultId, extracted.fullText);

	const analysis = await ctx.fullText.analyze({
		brandContext: ctx.brandContext,
		fullText: extracted.fullText,
		negativeBoost: ctx.negativeBoost,
	});
	if ("failed" in analysis) {
		tally.fullTextClassifyFailed += 1; // content_type left NULL
		tally.enhanceFailed += 1; //          sentiment/takeaway left NULL
		return false;
	}

	const decision = decideFullText(analysis, {
		tExclude: ctx.config.fullTextTExclude, // the STRICTER precision gate
		tVerified: ctx.config.tVerified,
	});
	if (decision.kind === "exclude") {
		const { code, detail } = offTopicExclusion(); // the look-alike caught on the page
		await ctx.repo.recordExclusion(resultId, code, detail);
		return false; // no Enhance write on an Excluded row
	}
	await ctx.repo.applyFullTextOutcome(resultId, decision.write);
	return true;
}
