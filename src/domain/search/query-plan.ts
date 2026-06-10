import type { ResolvedIdentity } from "../resolve/resolved-identity";
import type { SearchQuery } from "./search-query";
import { buildTimeSlices } from "./time-slice";

export type QueryPlan = {
	readonly broad: readonly SearchQuery[];
	readonly angle: readonly SearchQuery[];
	readonly typeTargeted: readonly SearchQuery[];
};

export type QueryPlanConfig = { horizonMonths: number; windowMonths: number };

const EVENT_ANGLES = ["funding", "acquisition", "partnership", "launch"];
const SLICED_ANGLES = ["news", "press release"]; // date-reliable → Time Sliced (ADR 0005)
const RARE_TYPES = ["podcast", "newsletter"];

/**
 * Pure builder over the ResolvedIdentity (PRD story 21). Effort order:
 * broad → angle → type-targeted. The builder does NOT decide what runs — the
 * stage runs broad always and the rest only on escalation. `now` and config are
 * injected so the entire plan is assertable.
 */
export function buildQueryPlan(
	identity: ResolvedIdentity,
	now: Date,
	config: QueryPlanConfig,
): QueryPlan {
	const name = identity.companyName;
	const positioning =
		identity.brandContext?.valueProposition ??
		identity.brandContext?.tagline ??
		identity.brandContext?.tags[0] ??
		null;

	const broad: SearchQuery[] = [
		{ kind: "broad", text: name, timeSlice: null },
		{ kind: "broad", text: `"${name}" coverage`, timeSlice: null },
	];
	if (positioning) {
		broad.push({
			kind: "broad",
			text: `"${name}" ${positioning}`,
			timeSlice: null,
		});
	}

	const slices = buildTimeSlices(
		now,
		config.horizonMonths,
		config.windowMonths,
	);
	const angle: SearchQuery[] = [
		...EVENT_ANGLES.map(
			(event): SearchQuery => ({
				kind: "angle",
				text: `"${name}" ${event}`,
				timeSlice: null,
			}),
		),
		...SLICED_ANGLES.flatMap((topic) =>
			slices.map(
				(timeSlice): SearchQuery => ({
					kind: "angle",
					text: `"${name}" ${topic}`,
					timeSlice,
				}),
			),
		),
	];

	const typeTargeted: SearchQuery[] = RARE_TYPES.map((type) => ({
		kind: "type_targeted",
		text: `"${name}" ${type}`,
		timeSlice: null,
	}));

	return { angle, broad, typeTargeted };
}
