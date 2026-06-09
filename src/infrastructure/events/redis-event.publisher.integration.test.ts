import { afterAll, describe, expect, it } from "vitest";
import type { JobNudge } from "../../application/ports/job-event-publisher.port";
import { createRedis } from "../redis/redis.connection";
import { jobChannel, RedisEventPublisher } from "./redis-event.publisher";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const pubConn = createRedis(REDIS_URL);
const subConn = createRedis(REDIS_URL);

describe("RedisEventPublisher (integration)", () => {
	afterAll(async () => {
		await pubConn.quit();
		await subConn.quit();
	});

	it("publishes an id-only status nudge a subscriber on the per-Job channel receives", async () => {
		const jobId = "job-pub-1";
		const received = new Promise<JobNudge>((resolve) => {
			subConn.on("message", (_channel, payload) =>
				resolve(JSON.parse(payload)),
			);
		});
		await subConn.subscribe(jobChannel(jobId));

		const publisher = new RedisEventPublisher(pubConn);
		await publisher.publish({ jobId, kind: "status" });

		expect(await received).toEqual({ jobId, kind: "status" });
	});

	it("never throws when the connection is broken (fire-and-forget, ADR 0006)", async () => {
		const broken = createRedis(REDIS_URL);
		await broken.quit(); // closed connection → publish will reject internally
		const warnings: string[] = [];
		const publisher = new RedisEventPublisher(broken, {
			warn: (m) => warnings.push(m),
		});
		await expect(
			publisher.publish({ jobId: "job-x", kind: "status" }),
		).resolves.toBeUndefined();
		expect(warnings.length).toBeGreaterThan(0);
	});
});
