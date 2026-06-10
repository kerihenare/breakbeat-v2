/** The closed Exclusion vocabulary (mirrors Foundation's Drizzle `exclusion_code` enum). */
export type ExclusionCode =
	| "own_channel"
	| "aggregator"
	| "ecommerce_review"
	| "out_of_window"
	| "duplicate"
	| "off_topic";

/** The subset Filter's heuristic pass may write (Collapse writes `duplicate`; `off_topic` is Verify's). */
export type HeuristicExclusionCode =
	| "own_channel"
	| "ecommerce_review"
	| "aggregator"
	| "out_of_window";
