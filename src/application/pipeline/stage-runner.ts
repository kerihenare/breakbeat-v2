import { JobFailedError } from "../../domain/job/job-errors";
import type { RunContext } from "./run-context";
import type { Stage } from "./stage.port";

/** What the runner reports to `runJob`; the use-case applies complete()/fail(). */
export type RunOutcome =
	| { kind: "completed" }
	| { kind: "failed"; reason: string };

/**
 * The in-process, sequential pipeline skeleton — the warn-vs-fail MECHANISM
 * (Foundation design §StageRunner). It holds an ordered list of stages (empty
 * in PRD 1) and runs them against one RunContext.
 *
 * Policy:
 *  - returns normally (with or without warnings) → continue
 *  - throws JobFailedError(reason)              → stop; failed with that reason
 *  - throws anything else (unexpected)          → stop; failed, reason records the throw
 *  - empty stage list                           → completed (the tracer-bullet path)
 *
 * The *thresholds* ("is my population empty?") belong to each stage; the
 * mechanism lives here, once. A judged-population-narrowed-to-zero is NOT a
 * runner concern — a stage that produced an empty-but-valid result returns
 * normally (and may Warn). The runner never persists.
 */
export class StageRunner {
	constructor(private readonly stages: readonly Stage[]) {}

	async run(ctx: RunContext): Promise<RunOutcome> {
		for (const stage of this.stages) {
			try {
				await stage.run(ctx);
			} catch (error) {
				if (error instanceof JobFailedError) {
					return { kind: "failed", reason: error.reason };
				}
				const detail = error instanceof Error ? error.message : String(error);
				return { kind: "failed", reason: `${stage.name}: ${detail}` };
			}
		}
		return { kind: "completed" };
	}
}
