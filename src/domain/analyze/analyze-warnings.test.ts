import { describe, expect, it } from "vitest";
import { ANALYZE_WARNING, analyzeWarnings } from "./analyze-warnings";

describe("analyze warnings", () => {
	it("exposes the closed namespaced set", () => {
		expect(Object.values(ANALYZE_WARNING).sort()).toEqual(
			[
				"analyze.extract_failed",
				"analyze.snippet_classify_failed",
				"analyze.full_text_classify_failed",
				"analyze.enhance_failed",
				"analyze.classify_totally_failed",
				"analyze.no_brand_context",
			].sort(),
		);
	});

	it("every type is namespaced under 'analyze.'", () => {
		expect(
			Object.values(ANALYZE_WARNING).every((t) => t.startsWith("analyze.")),
		).toBe(true);
	});

	it("the per-Result aggregated builders carry a COUNT, never raw text", () => {
		const extract = analyzeWarnings.extractFailed(7);
		expect(extract.type).toBe(ANALYZE_WARNING.extractFailed);
		expect(extract.message).toContain("7");

		const snippet = analyzeWarnings.snippetClassifyFailed(3);
		expect(snippet.type).toBe(ANALYZE_WARNING.snippetClassifyFailed);
		expect(snippet.message).toContain("3");

		const fullText = analyzeWarnings.fullTextClassifyFailed(2);
		expect(fullText.type).toBe(ANALYZE_WARNING.fullTextClassifyFailed);
		expect(fullText.message).toContain("2");

		const enhance = analyzeWarnings.enhanceFailed(5);
		expect(enhance.type).toBe(ANALYZE_WARNING.enhanceFailed);
		expect(enhance.message).toContain("5");
	});

	it("the Job-level builders take no count and produce a non-empty message of the matching type", () => {
		const total = analyzeWarnings.classifyTotallyFailed();
		expect(total.type).toBe(ANALYZE_WARNING.classifyTotallyFailed);
		expect(total.message.length).toBeGreaterThan(0);

		const noBrand = analyzeWarnings.noBrandContext();
		expect(noBrand.type).toBe(ANALYZE_WARNING.noBrandContext);
		expect(noBrand.message.length).toBeGreaterThan(0);
	});
});
