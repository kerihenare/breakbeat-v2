import { describe, expect, it } from "vitest";
import { toScoreBar } from "./match-score.vm";
import { readVerification } from "./null-readings";

describe("toScoreBar", () => {
	it("maps a numeric score to a scored VM where widthPct === numeric", () => {
		expect(toScoreBar(74)).toEqual({
			kind: "scored",
			numeric: 74,
			widthPct: 74,
		});
		expect(toScoreBar(98)).toEqual({
			kind: "scored",
			numeric: 98,
			widthPct: 98,
		});
	});

	it("maps NULL to an unscored VM", () => {
		expect(toScoreBar(null)).toEqual({ kind: "unscored" });
	});

	it("clamps and rounds at the 0/100 boundaries", () => {
		expect(toScoreBar(0)).toEqual({ kind: "scored", numeric: 0, widthPct: 0 });
		expect(toScoreBar(100)).toEqual({
			kind: "scored",
			numeric: 100,
			widthPct: 100,
		});
		expect(toScoreBar(150)).toEqual({
			kind: "scored",
			numeric: 100,
			widthPct: 100,
		});
		expect(toScoreBar(-20)).toEqual({
			kind: "scored",
			numeric: 0,
			widthPct: 0,
		});
		expect(toScoreBar(73.6)).toEqual({
			kind: "scored",
			numeric: 74,
			widthPct: 74,
		});
	});

	it("LOAD-BEARING: a NULL verification with a numeric score shows the bar AND 'Unverified' independently", () => {
		// An Extract-failed Result: status NULL, score 74. The row composes the two separately —
		// one NULL never implies the other.
		const status = null;
		const matchScore = 74;
		const score = toScoreBar(matchScore);
		const verification = readVerification(status);
		expect(score).toEqual({ kind: "scored", numeric: 74, widthPct: 74 }); // bar present at 74
		expect(verification).toBe("Unverified"); // reading present
	});

	it("LOAD-BEARING reverse: a verified Result may still be unscored", () => {
		expect(toScoreBar(null)).toEqual({ kind: "unscored" });
		expect(readVerification("verified")).toBe("Verified");
	});
});
