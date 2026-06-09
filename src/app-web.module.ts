import { Module } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Clock } from "./application/ports/clock.port";
import { CLOCK } from "./application/ports/clock.port";
import type { IdGenerator } from "./application/ports/id-generator.port";
import { ID_GENERATOR } from "./application/ports/id-generator.port";
import type { JobQueue } from "./application/ports/job-queue.port";
import { JOB_QUEUE } from "./application/ports/job-queue.port";
import type { JobRepository } from "./application/ports/job-repository.port";
import { JOB_REPOSITORY } from "./application/ports/job-repository.port";
import {
	JOBS_LIST_READ_MODEL,
	RESULTS_READ_MODEL,
} from "./application/ports/read-models.port";
import { SubmitJobUseCase } from "./application/submit-job.usecase";
import type { DatabaseConnection } from "./infrastructure/persistence/database";
import {
	DrizzleJobsListReadModel,
	DrizzleResultsReadModel,
} from "./infrastructure/persistence/read-models";
import { BullJobProducer, createQueue } from "./infrastructure/queue/job.queue";
import { ConnectionsLifecycle } from "./interface/connections.lifecycle";
import { coreProviders } from "./interface/core.providers";
import {
	DB_CONNECTION,
	QUEUE,
	REDIS_CONNECTION,
	SUBMIT_JOB,
} from "./interface/di-tokens";
import { JobsController } from "./interface/web/jobs.controller";
import { PagesController } from "./interface/web/pages.controller";

/** The web DI graph: HTTP surface + the producer side of the queue. */
@Module({
	controllers: [PagesController, JobsController],
	providers: [
		...coreProviders,
		{
			inject: [REDIS_CONNECTION],
			provide: QUEUE,
			useFactory: (r: Redis) => createQueue(r),
		},
		{
			inject: [QUEUE],
			provide: JOB_QUEUE,
			useFactory: (q: Queue) => new BullJobProducer(q),
		},
		{
			inject: [JOB_REPOSITORY, JOB_QUEUE, CLOCK, ID_GENERATOR],
			provide: SUBMIT_JOB,
			useFactory: (
				jobs: JobRepository,
				queue: JobQueue,
				clock: Clock,
				ids: IdGenerator,
			) => new SubmitJobUseCase(jobs, queue, clock, ids),
		},
		{
			inject: [DB_CONNECTION],
			provide: JOBS_LIST_READ_MODEL,
			useFactory: (c: DatabaseConnection) => new DrizzleJobsListReadModel(c.db),
		},
		{
			inject: [DB_CONNECTION],
			provide: RESULTS_READ_MODEL,
			useFactory: (c: DatabaseConnection) => new DrizzleResultsReadModel(c.db),
		},
		ConnectionsLifecycle,
	],
})
export class AppWebModule {}
