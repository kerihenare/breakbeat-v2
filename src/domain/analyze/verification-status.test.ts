import { describe, expect, it } from "vitest";
import {
	type Cutoffs,
	classifyScore,
	type VerificationStatus,
} from "./verification-status";

const SNIPPET: Cutoffs = { tExclude: 25, tVerified: 70 }; // lenient snippet-pass cutoff
const FULL_TEXT: Cutoffs = { tExclude: 40, tVerified: 70 }; // stricter full-text cutoff

describe("classifyScore", () => {
	it("below tExclude → exclude", () => {
		expect(classifyScore(0, FULL_TEXT)).toEqual({ kind: "exclude" });
		expect(classifyScore(39, FULL_TEXT)).toEqual({ kind: "exclude" });
	});

	it("[tExclude, tVerified) → uncertain", () => {
		expect(classifyScore(40, FULL_TEXT)).toEqual({
			kind: "uncertain",
			status: "uncertain",
		});
		expect(classifyScore(69, FULL_TEXT)).toEqual({
			kind: "uncertain",
			status: "uncertain",
		});
	});

	it("≥ tVerified → verified", () => {
		expect(classifyScore(70, FULL_TEXT)).toEqual({
			kind: "verified",
			status: "verified",
		});
		expect(classifyScore(100, FULL_TEXT)).toEqual({
			kind: "verified",
			status: "verified",
		});
	});

	it("the exact boundary scores bucket as specified (tExclude → uncertain, tVerified → verified)", () => {
		expect(classifyScore(25, SNIPPET)).toEqual({
			kind: "uncertain",
			status: "uncertain",
		});
		expect(classifyScore(70, SNIPPET)).toEqual({
			kind: "verified",
			status: "verified",
		});
	});

	it("the lenient-vs-strict boundary: a score in [snippetTExclude, fullTextTExclude) survives the snippet pass but Excludes at full text", () => {
		// 30 is the recall-protecting design: thin snippet survives (cost gate); the page Excludes it.
		expect(classifyScore(30, SNIPPET)).toEqual({
			kind: "uncertain",
			status: "uncertain",
		});
		expect(classifyScore(30, FULL_TEXT)).toEqual({ kind: "exclude" });
	});

	it("only ever returns the two stored statuses (verified | uncertain); NULL is never returned here", () => {
		const verdicts = [
			classifyScore(10, FULL_TEXT),
			classifyScore(50, FULL_TEXT),
			classifyScore(90, FULL_TEXT),
		];
		const statuses = verdicts.flatMap((v) => ("status" in v ? [v.status] : []));
		const allowed: VerificationStatus[] = ["verified", "uncertain"];
		expect(statuses.every((s) => allowed.includes(s))).toBe(true);
	});
});
