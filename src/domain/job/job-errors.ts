import type { JobState } from "./job-state";

/**
 * Thrown by the Job aggregate on any illegal state transition. This is a
 * programming error, not a Job outcome — use-cases let it propagate; it never
 * reaches the DB.
 */
export class IllegalTransitionError extends Error {
	constructor(
		readonly from: JobState,
		readonly attempted: string,
	) {
		super(`Illegal transition: cannot '${attempted}' from state '${from}'`);
		this.name = "IllegalTransitionError";
	}
}

/**
 * The explicit "nothing to show" signal a stage throws to fail the Job
 * (CONTEXT.md "Warning": a stage fails the Job only when it leaves no
 * population to judge). Distinct from an unexpected throw so the runner can
 * record an honest reason.
 */
export class JobFailedError extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = "JobFailedError";
	}
}
