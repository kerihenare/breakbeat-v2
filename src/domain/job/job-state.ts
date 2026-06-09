/**
 * The Job state machine (CONTEXT.md "Job", PRD 1).
 *
 * pending ──start──▶ running ──┬─complete(no warnings)──▶ done
 *                              ├─complete(warnings ≠ ∅)──▶ done_with_warnings
 *                              └─fail──────────────────▶ failed
 *
 * The three terminal states are absorbing. `done` vs `done_with_warnings` is a
 * DERIVED property of the warning list, never a caller's choice.
 */
export type JobState =
	| "pending"
	| "running"
	| "done"
	| "done_with_warnings"
	| "failed";

export const TERMINAL_STATES = [
	"done",
	"done_with_warnings",
	"failed",
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminal(state: JobState): state is TerminalState {
	return (TERMINAL_STATES as readonly string[]).includes(state);
}
