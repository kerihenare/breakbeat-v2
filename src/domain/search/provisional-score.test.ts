import { describe, expect, it } from "vitest";
import {
	BACKSTOP_PROVISIONAL_SCORE,
	tavilyProvisionalScore,
} from "./provisional-score";

describe("tavilyProvisionalScore", () => {
	it("scales Tavily's 0-1 relevance into the 0-100 Match Score key", () => {
		expect(tavilyProvisionalScore(0.9)).toBe(90);
		expect(tavilyProvisionalScore(0.123)).toBe(12);
		expect(tavilyProvisionalScore(1)).toBe(100);
	});

	it("never scores a returned hit at 0 (a returned hit has some relevance)", () => {
		expect(tavilyProvisionalScore(0)).toBe(1);
		expect(tavilyProvisionalScore(null)).toBe(1);
		expect(tavilyProvisionalScore(0.001)).toBe(1);
	});

	it("places the backstop floor strictly beneath every Tavily-scored row", () => {
		expect(BACKSTOP_PROVISIONAL_SCORE).toBe(0);
		expect(BACKSTOP_PROVISIONAL_SCORE).toBeLessThan(tavilyProvisionalScore(0));
	});
});
