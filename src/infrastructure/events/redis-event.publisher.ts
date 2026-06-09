import type { Redis } from "ioredis";
import type {
	JobEventPublisher,
	JobNudge,
} from "../../application/ports/job-event-publisher.port";

/** The per-Job pub/sub channel the web SSE subscriber will listen on (PRD 7). */
export function jobChannel(jobId: string): string {
	return `breakbeat:job:${jobId}`;
}

export interface MinimalLogger {
	warn(message: string): void;
}

/**
 * ioredis adapter for the JobEventPublisher port (ADR 0006). Publishes an
 * id-only nudge after a committed DB write. Fire-and-forget: a publish failure
 * is logged and swallowed — Postgres is the source of truth, so a dropped nudge
 * is harmless. This is the ONLY sanctioned silent failure in PRD 1. The nudge
 * is JSON of `{ jobId, kind, id? }` only — no Result content or model text
 * (anti-echo).
 */
export class RedisEventPublisher implements JobEventPublisher {
	constructor(
		private readonly redis: Redis,
		private readonly logger?: MinimalLogger,
	) {}

	async publish(nudge: JobNudge): Promise<void> {
		try {
			await this.redis.publish(jobChannel(nudge.jobId), JSON.stringify(nudge));
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.logger?.warn(
				`Redis publish failed for job ${nudge.jobId} (${nudge.kind}): ${detail}`,
			);
		}
	}
}
