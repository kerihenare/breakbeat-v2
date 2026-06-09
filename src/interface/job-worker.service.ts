import {
	Inject,
	Injectable,
	type OnApplicationShutdown,
	type OnModuleInit,
} from "@nestjs/common";
import type { Worker } from "bullmq";
import type { Redis } from "ioredis";
import type { RunJobUseCase } from "../application/run-job.usecase";
import type { Env } from "../config/env";
import { createJobWorker } from "../infrastructure/queue/job.queue";
import { createRedis } from "../infrastructure/redis/redis.connection";
import { ENV, RUN_JOB } from "./di-tokens";

/**
 * Hosts the BullMQ consumer on `breakbeat-worker`. The worker uses its own Redis
 * connection (blocking commands). Shutdown order: `worker.close()` drains the
 * active Job before the connection is quit (ADR 0004 drain-worker step).
 */
@Injectable()
export class JobWorkerService implements OnModuleInit, OnApplicationShutdown {
	private worker?: Worker;
	private connection?: Redis;

	constructor(
		@Inject(ENV) private readonly env: Env,
		@Inject(RUN_JOB) private readonly runJob: RunJobUseCase,
	) {}

	onModuleInit(): void {
		this.connection = createRedis(this.env.REDIS_URL);
		this.worker = createJobWorker(this.connection, this.runJob);
	}

	async onApplicationShutdown(): Promise<void> {
		await this.worker?.close();
		await this.connection?.quit();
	}
}
