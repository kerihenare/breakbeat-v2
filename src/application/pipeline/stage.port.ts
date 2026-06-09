import type { RunContext } from "./run-context";

/**
 * The uniform interface every later PRD's stage implements. A stage does its
 * work, calls `ctx.recordWarning(...)` for any recoverable shortfall, and
 * returns normally on success. To fail the Job it throws `JobFailedError`.
 *
 * The closed `name` set lands per-stage: `resolve | search | filter | analyze |
 * summarise` (ADR 0004 metric labels).
 */
export interface Stage {
	readonly name: string;
	run(ctx: RunContext): Promise<void>;
}

/** DI token for the ordered list of stages the runner executes. */
export const STAGES = Symbol("Stages");
