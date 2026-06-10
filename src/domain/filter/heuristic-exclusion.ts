import type { ResolvedIdentity } from "../resolve/resolved-identity";
import { isAggregator } from "./aggregator";
import { isEcommerceReview } from "./ecommerce-review";
import type { HeuristicExclusionCode } from "./exclusion-code";
import type { FilterConfig } from "./filter-config";
import type { FilterResult } from "./filter-result";
import { isOutOfWindow } from "./out-of-window";
import { isOwnChannel } from "./own-channel";

/**
 * The fixed-priority gate: own_channel → ecommerce_review → aggregator → out_of_window. The first
 * match wins, so a Result qualifying for several codes gets one predictable, explainable code
 * (most-specific surface first; "merely too old" last). Returns null when no rule matches.
 */
export function heuristicExclusion(
	result: FilterResult,
	identity: ResolvedIdentity,
	now: Date,
	config: FilterConfig,
): HeuristicExclusionCode | null {
	if (isOwnChannel(result, identity)) return "own_channel";
	if (isEcommerceReview(result)) return "ecommerce_review";
	if (isAggregator(result)) return "aggregator";
	if (isOutOfWindow(result.publishedDate, now, config.horizonMonths))
		return "out_of_window";
	return null;
}
