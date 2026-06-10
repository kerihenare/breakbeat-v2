import { afterAll, describe, expect, it } from "vitest";
import type { JobNudge } from "../../application/ports/job-event-publisher.port";
import { createRedis } from "../redis/redis.connection";
import { RedisEventPublisher } from "./redis-event.publisher";
import { RedisEventSubscriber } from "./redis-event.subscriber";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const baseConn = createRedis(REDIS_URL);
const pubConn = createRedis(REDIS_URL);

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!cond()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
		await delay(10);
	}
}

describe("RedisEventSubscriber (integration)", () => {
	afterAll(async () => {
		await baseConn.quit();
		await pubConn.quit();
	});

	it("delivers a published nudge to the callback, then stops after teardown", async () => {
		const jobId = "job-sub-1";
		const subscriber = new RedisEventSubscriber(baseConn);
		const received: JobNudge[] = [];
		const stop = await subscriber.subscribe(jobId, (n) => received.push(n));

		const publisher = new RedisEventPublisher(pubConn);
		await publisher.publish({ id: "r1", jobId, kind: "result" });

		await waitFor(() => received.length === 1);
		expect(received[0]).toEqual({ id: "r1", jobId, kind: "result" });

		await stop();
		await publisher.publish({ jobId, kind: "status" });
		await delay(100);
		expect(received).toHaveLength(1); // nothing arrives after teardown
	});

	it("never delivers another Job's nudge to this subscription", async () => {
		const subscriber = new RedisEventSubscriber(baseConn);
		const received: JobNudge[] = [];
		const stop = await subscriber.subscribe("job-A", (n) => received.push(n));

		const publisher = new RedisEventPublisher(pubConn);
		await publisher.publish({ jobId: "job-B", kind: "status" });
		await delay(100);

		expect(received).toHaveLength(0);
		await stop();
	});
});
