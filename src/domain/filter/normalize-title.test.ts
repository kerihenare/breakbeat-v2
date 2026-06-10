import { describe, expect, it } from "vitest";
import { normalizeTitle } from "./normalize-title";

describe("normalizeTitle", () => {
	it("lowercases, collapses whitespace, and strips punctuation", () => {
		expect(normalizeTitle("  Aglow  Raises  $5M!! ")).toBe("aglow raises 5m");
	});
	it("strips a trailing source/site suffix after a known separator", () => {
		expect(
			normalizeTitle(
				"Aglow raises $5M in seed funding — Business News Australia",
			),
		).toBe("aglow raises 5m in seed funding");
		expect(
			normalizeTitle("Aglow raises $5M in seed funding | Startup Daily"),
		).toBe("aglow raises 5m in seed funding");
	});
	it("does NOT strip a long tail that is unlikely to be a publisher name", () => {
		const t =
			"Aglow - a full sentence clause that runs well beyond a short publisher byline tail here";
		expect(normalizeTitle(t)).toContain("a full sentence clause");
	});
	it("maps two genuinely different titles to different keys", () => {
		expect(normalizeTitle("Aglow launches app")).not.toBe(
			normalizeTitle("Aglow raises funding"),
		);
	});
});
