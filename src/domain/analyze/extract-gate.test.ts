import { describe, expect, it } from "vitest";
import { type SnippetOutcome, survivedSnippetGates } from "./extract-gate";

describe("survivedSnippetGates", () => {
	it("is false for a snippet-Excluded outcome (never Extracted — the cost gate)", () => {
		const excluded: SnippetOutcome = { kind: "excluded" };
		expect(survivedSnippetGates(excluded)).toBe(false);
	});

	it("is true for a survived outcome and narrows the type so interimScore is accessible", () => {
		const survived: SnippetOutcome = {
			interimScore: 62,
			kind: "survived",
			provisionalType: "news_article",
		};
		expect(survivedSnippetGates(survived)).toBe(true);
		if (survivedSnippetGates(survived)) {
			expect(survived.interimScore).toBe(62); // narrowing compiles
		}
	});

	it("survives even when snippet-Classify yielded no provisional type (it never gates)", () => {
		const survived: SnippetOutcome = {
			interimScore: 30,
			kind: "survived",
			provisionalType: null,
		};
		expect(survivedSnippetGates(survived)).toBe(true);
	});
});
