/**
 * Match Score → numeric reading + confidence-bar width. A NULL Match Score
 * reads "Unverified" (the score is absent, not zero) and the bar is empty.
 * Independent of verification_status — a row may show a numeric score while its
 * verification reading is still "Unverified" (CONTEXT.md / PRD 7).
 */
export interface MatchScoreView {
	readonly reading: string;
	readonly score: number | null;
	readonly barWidth: number;
	readonly isUnverified: boolean;
}

export function matchScoreView(score: number | null): MatchScoreView {
	if (score === null) {
		return {
			barWidth: 0,
			isUnverified: true,
			reading: "Unverified",
			score: null,
		};
	}
	const clamped = Math.max(0, Math.min(100, Math.round(score)));
	return {
		barWidth: clamped,
		isUnverified: false,
		reading: String(clamped),
		score: clamped,
	};
}
