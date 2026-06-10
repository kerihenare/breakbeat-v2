import { describe, expect, it } from "vitest";
import { type MatchScoreRung, ratchet } from "./match-score";

describe("ratchet", () => {
	it("clamps and rounds a score into the 0-100 ordering key", () => {
		expect(ratchet("interim", 73.4)).toBe(73);
		expect(ratchet("final", 73.6)).toBe(74);
		expect(ratchet("provisional", -5)).toBe(0);
		expect(ratchet("final", 142)).toBe(100);
	});

	it("treats the boundary values 0 and 100 as valid", () => {
		expect(ratchet("interim", 0)).toBe(0);
		expect(ratchet("final", 100)).toBe(100);
	});

	it("is a pure function of (rung, score) — the rung never changes the number", () => {
		const rungs: MatchScoreRung[] = ["provisional", "interim", "final"];
		for (const rung of rungs) expect(ratchet(rung, 55)).toBe(55);
	});

	it("models latest-rung-overwrites: a sequence keeps only the latest value (no blend/max/average)", () => {
		// The shell writes provisional (Search), then interim, then final; each call returns the latest
		// rung's own clamped score — there is no read of the prior persisted value.
		const provisional = ratchet("provisional", 40);
		const interim = ratchet("interim", 62);
		const final = ratchet("final", 35);
		expect([provisional, interim, final]).toEqual([40, 62, 35]); // final overwrites even when LOWER
	});
});
