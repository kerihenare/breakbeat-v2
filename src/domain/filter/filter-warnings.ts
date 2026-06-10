import { type Warning, warning } from "../job/warning";

export const FILTER_WARNING = {
	ownChannelDegraded: "filter.own_channel_degraded",
} as const;

/**
 * Filter's one Warning. The message carries no raw URL and no model text (anti-echo) — the
 * heuristics emit no model text at all. A degraded own-channel pass is an OK/Warning condition,
 * never a Job failure.
 */
export const filterWarnings = {
	ownChannelDegraded: (): Warning =>
		warning(
			FILTER_WARNING.ownChannelDegraded,
			"No resolved own domains; the own-channel heuristic ran on available signal only, deferring the rest to the Classify backstop.",
		),
};
