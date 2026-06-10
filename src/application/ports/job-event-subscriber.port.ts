import type { JobNudge } from "./job-event-publisher.port";

/**
 * Subscribes to a single Job's nudge channel (ADR 0006). The web SSE handler
 * uses this to learn when a Job committed a write and should be re-read. The
 * returned function unsubscribes and releases the underlying connection — the
 * SSE handler calls it when the client disconnects.
 */
export interface JobEventSubscriber {
	subscribe(
		jobId: string,
		onNudge: (nudge: JobNudge) => void,
	): Promise<() => Promise<void>>;
}

export const JOB_EVENT_SUBSCRIBER = Symbol("JobEventSubscriber");
