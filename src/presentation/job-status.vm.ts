/**
 * JobState → badge. The label and dotKind carry the meaning for colour-blind
 * users; `tone` only selects the palette step (CSS stills the `pulse` under
 * prefers-reduced-motion). Mirrors Foundation's JobState union.
 */
export type JobState =
	| "pending"
	| "running"
	| "done"
	| "done_with_warnings"
	| "failed";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "error";
export type StatusDotKind = "idle" | "pulse" | "solid";
export type StatusBadge = {
	label: string;
	tone: StatusTone;
	dotKind: StatusDotKind;
	isTerminal: boolean;
	isRunning: boolean;
};

const BADGES: Record<JobState, StatusBadge> = {
	done: {
		dotKind: "solid",
		isRunning: false,
		isTerminal: true,
		label: "Done",
		tone: "success",
	},
	done_with_warnings: {
		dotKind: "solid",
		isRunning: false,
		isTerminal: true,
		label: "Done · warnings",
		tone: "warning",
	},
	failed: {
		dotKind: "solid",
		isRunning: false,
		isTerminal: true,
		label: "Failed",
		tone: "error",
	},
	pending: {
		dotKind: "idle",
		isRunning: false,
		isTerminal: false,
		label: "Pending",
		tone: "neutral",
	},
	running: {
		dotKind: "pulse",
		isRunning: true,
		isTerminal: false,
		label: "Researching…",
		tone: "info",
	},
};

const FALLBACK: StatusBadge = {
	dotKind: "idle",
	isRunning: false,
	isTerminal: false,
	label: "Pending",
	tone: "neutral",
};

export function toStatusBadge(state: JobState | string): StatusBadge {
	return BADGES[state as JobState] ?? FALLBACK;
}
