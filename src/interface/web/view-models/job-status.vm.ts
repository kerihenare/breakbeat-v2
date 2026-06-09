/**
 * Job status → badge. Meaning is never colour-only (DESIGN.md / PRD 7): every
 * badge pairs a `tone` (which drives a dot colour) with a text `label`, and the
 * running state is distinguishable from the terminal states by its words alone.
 */
export type StatusTone = "pending" | "running" | "done" | "warning" | "failed";

export interface JobStatusView {
	readonly label: string;
	readonly tone: StatusTone;
	readonly isTerminal: boolean;
	readonly isRunning: boolean;
}

const VIEWS: Record<string, JobStatusView> = {
	done: { isRunning: false, isTerminal: true, label: "Done", tone: "done" },
	done_with_warnings: {
		isRunning: false,
		isTerminal: true,
		label: "Done with warnings",
		tone: "warning",
	},
	failed: {
		isRunning: false,
		isTerminal: true,
		label: "Failed",
		tone: "failed",
	},
	pending: {
		isRunning: false,
		isTerminal: false,
		label: "Queued",
		tone: "pending",
	},
	running: {
		isRunning: true,
		isTerminal: false,
		label: "Researching…",
		tone: "running",
	},
};

export function jobStatusView(state: string): JobStatusView {
	return (
		VIEWS[state] ?? {
			isRunning: false,
			isTerminal: false,
			label: state,
			tone: "pending",
		}
	);
}
