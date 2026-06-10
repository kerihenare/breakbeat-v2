import { describe, expect, it } from "vitest";
import { type AnalyzeConfig, assertAnalyzeConfig } from "./analyze-config";

const base: AnalyzeConfig = {
	extractConcurrency: 5,
	fullTextTExclude: 40,
	snippetTExclude: 25,
	takeawayMaxLength: 400,
	tVerified: 70,
};

describe("assertAnalyzeConfig", () => {
	it("returns the config unchanged when the cutoff ordering holds", () => {
		expect(assertAnalyzeConfig(base)).toEqual(base);
	});

	it("accepts the boundary fullTextTExclude === tVerified", () => {
		expect(() =>
			assertAnalyzeConfig({ ...base, fullTextTExclude: 70, tVerified: 70 }),
		).not.toThrow();
	});

	it("rejects a snippetTExclude that is not strictly less than fullTextTExclude (the lenient-vs-strict invariant)", () => {
		expect(() =>
			assertAnalyzeConfig({
				...base,
				fullTextTExclude: 40,
				snippetTExclude: 40,
			}),
		).toThrow();
	});

	it("rejects a fullTextTExclude above tVerified", () => {
		expect(() =>
			assertAnalyzeConfig({ ...base, fullTextTExclude: 80, tVerified: 70 }),
		).toThrow();
	});

	it("rejects a non-positive concurrency", () => {
		expect(() =>
			assertAnalyzeConfig({ ...base, extractConcurrency: 0 }),
		).toThrow();
	});
});
