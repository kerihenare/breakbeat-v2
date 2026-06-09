/**
 * An id-only nudge published after a committed DB write (ADR 0006).
 *
 * The discriminated shape is fixed now (Foundation) even though PRD 1 only ever
 * publishes `{ kind: "status" }`: PRD 7 adds the per-Result `{ kind: "result",
 * id }` publish seam and the web SSE subscriber WITHOUT editing this interface.
 * The nudge carries no Result content or model text (anti-echo); Postgres is
 * the source of truth, so a dropped/duplicated nudge is harmless.
 */
export interface JobNudge {
	readonly jobId: string;
	readonly kind: "status" | "result";
	readonly id?: string;
}

/** Fire-and-forget publisher. Implemented by the ioredis adapter. */
export interface JobEventPublisher {
	publish(nudge: JobNudge): Promise<void>;
}

export const JOB_EVENT_PUBLISHER = Symbol("JobEventPublisher");
