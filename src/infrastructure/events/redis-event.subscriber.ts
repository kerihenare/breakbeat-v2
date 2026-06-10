import type { Redis } from "ioredis";
import type { JobNudge } from "../../application/ports/job-event-publisher.port";
import type { JobEventSubscriber } from "../../application/ports/job-event-subscriber.port";
import { jobChannel } from "./redis-event.publisher";

export interface MinimalLogger {
	warn(message: string): void;
}

/**
 * ioredis subscriber for the per-Job nudge channel (ADR 0006), the read side of
 * `RedisEventPublisher`. ioredis puts a connection into subscriber mode, so each
 * subscription DUPLICATES the base connection and owns it for the life of the
 * SSE stream; the returned teardown unsubscribes and closes that connection. A
 * malformed payload is logged and ignored — Postgres is the source of truth, so
 * a dropped nudge is harmless.
 */
export class RedisEventSubscriber implements JobEventSubscriber {
	constructor(
		private readonly redis: Redis,
		private readonly logger?: MinimalLogger,
	) {}

	async subscribe(
		jobId: string,
		onNudge: (nudge: JobNudge) => void,
	): Promise<() => Promise<void>> {
		const channel = jobChannel(jobId);
		const conn = this.redis.duplicate();

		const handler = (incoming: string, message: string): void => {
			if (incoming !== channel) return;
			try {
				const nudge = JSON.parse(message) as JobNudge;
				if (nudge?.jobId === jobId) onNudge(nudge);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				this.logger?.warn(`Ignoring malformed nudge on ${channel}: ${detail}`);
			}
		};

		conn.on("message", handler);
		await conn.subscribe(channel);

		return async () => {
			conn.off("message", handler);
			try {
				await conn.unsubscribe(channel);
			} catch {
				// best-effort; the disconnect below releases the socket regardless
			}
			conn.disconnect();
		};
	}
}
