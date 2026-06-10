/**
 * The Match Score Indicator VM. `scored` carries the 0–100 numeric and an equal
 * `widthPct` (the bar fills Ink, structural — the template uses the Ink token,
 * never a brand bright). `unscored` is rendered as the "Unverified" reading by
 * the row VM, INDEPENDENT of verification_status (one NULL never implies the
 * other — see match-score.vm.test.ts).
 */
export type ScoreVM =
	| { kind: "scored"; numeric: number; widthPct: number }
	| { kind: "unscored" };

export function toScoreBar(matchScore: number | null): ScoreVM {
	if (matchScore === null) return { kind: "unscored" };
	const numeric = Math.min(100, Math.max(0, Math.round(matchScore)));
	return { kind: "scored", numeric, widthPct: numeric };
}
