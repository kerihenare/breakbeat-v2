import type { TimeSlice } from "./time-slice";

export type SearchQueryKind = "broad" | "angle" | "type_targeted";

export type SearchQuery = {
	readonly text: string;
	readonly kind: SearchQueryKind;
	readonly timeSlice: TimeSlice | null; // set only on news / press-release angle queries
};
