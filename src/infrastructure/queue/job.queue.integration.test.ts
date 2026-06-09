import type { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stage } from "../../application/pipeline/stage.port";
import { StageRunner } from "../../application/pipeline/stage-runner";
import type { JobEventPublisher } from "../../application/ports/job-event-publisher.port";
import { RunJobUseCase } from "../../application/run-job.usecase";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { JobFailedError } from "../../domain/job/job-errors";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateAll,
} from "../../testing/integration-db";
import { DrizzleJobRepository } from "../persistence/job.repository";
import { createRedis } from "../redis/redis.connection";
import { SystemClock } from "../system/system-clock";
import { BullJobProducer, createJobWorker, createQueue } from "./job.queue";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Isolate the test queue from any running dev worker on the same Redis.
const TEST_PREFIX = "bbtest";
const noopPublisher: JobEventPublisher = { publish: async () => {} };

const db = getTestDatabase();
const repo = new DrizzleJobRepository(db);
const queueConn = createRedis(REDIS_URL);

let queue: Queue;
let worker: Worker | null = null;
let workerConn: Redis | null = null;

async function waitForState(
	jobId: string,
	predicate: (s: string) => boolean,
	timeoutMs = 8000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const job = await repo.findById(jobId);
		if (job && predicate(job.state)) return job.state;
		await new Promise((r) => setTimeout(r, 50));
	}
	const job = await repo.findById(jobId);
	throw new Error(`timed out waiting; last state = ${job?.state ?? "<none>"}`);
}

function startWorker(stages: Stage[]): void {
	const runJob = new RunJobUseCase(
		repo,
		noopPublisher,
		new SystemClock(),
		new StageRunner(stages),
	);
	workerConn = createRedis(REDIS_URL);
	worker = createJobWorker(workerConn, runJob, { prefix: TEST_PREFIX });
}

describe("BullMQ queue + worker (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
		queue = createQueue(queueConn, { prefix: TEST_PREFIX });
		await queue.obliterate({ force: true });
	});

	afterEach(async () => {
		if (worker) {
			await worker.close();
			worker = null;
		}
		if (workerConn) {
			await workerConn.quit();
			workerConn = null;
		}
		await queue.obliterate({ force: true });
		await queue.close();
	});

	it("enqueue → worker claims → empty pipeline drives the Job to done", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), new Date());
		await repo.save(job);
		startWorker([]);

		await new BullJobProducer(queue).enqueue({ jobId: job.id });

		expect(await waitForState(job.id, (s) => s === "done")).toBe("done");
	});

	it("a stage that signals 'nothing to show' drives failed, never stuck running", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), new Date());
		await repo.save(job);
		const failing: Stage = {
			name: "search",
			run: async () => {
				throw new JobFailedError("all search queries failed");
			},
		};
		startWorker([failing]);

		await new BullJobProducer(queue).enqueue({ jobId: job.id });

		expect(await waitForState(job.id, (s) => s === "failed")).toBe("failed");
		expect((await repo.findById(job.id))?.failureReason).toBe(
			"all search queries failed",
		);
	});
});

describe("teardown", () => {
	it("closes shared connections", async () => {
		await queueConn.quit();
		await closeTestDatabase();
	});
});
