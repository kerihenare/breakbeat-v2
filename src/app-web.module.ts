import { Module } from "@nestjs/common";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Clock } from "./application/ports/clock.port";
import { CLOCK } from "./application/ports/clock.port";
import type { IdGenerator } from "./application/ports/id-generator.port";
import { ID_GENERATOR } from "./application/ports/id-generator.port";
import { JOB_EVENT_SUBSCRIBER } from "./application/ports/job-event-subscriber.port";
import type { JobQueue } from "./application/ports/job-queue.port";
import { JOB_QUEUE } from "./application/ports/job-queue.port";
import type { JobRepository } from "./application/ports/job-repository.port";
import { JOB_REPOSITORY } from "./application/ports/job-repository.port";
import {
	JOBS_LIST_READ_MODEL,
	RESOLVED_IDENTITY_READ_MODEL,
	RESULTS_READ_MODEL,
	SUMMARY_READ_MODEL,
} from "./application/ports/read-models.port";
import { SubmitJobUseCase } from "./application/submit-job.usecase";
import { BrandfetchModule } from "./infrastructure/brandfetch/brandfetch.module";
import { RedisEventSubscriber } from "./infrastructure/events/redis-event.subscriber";
import { OtelLifecycle } from "./infrastructure/observability/otel-lifecycle";
import type { DatabaseConnection } from "./infrastructure/persistence/database";
import {
	DrizzleJobsListReadModel,
	DrizzleResolvedIdentityReadModel,
	DrizzleResultsReadModel,
	DrizzleSummaryReadModel,
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
import { BrandSearchController } from "./interface/web/brand-search.controller";
import { JobsController } from "./interface/web/jobs.controller";
import { PagesController } from "./interface/web/pages.controller";
import { SseController } from "./interface/web/sse.controller";

/** The web DI graph: HTTP surface + the producer side of the queue. */
@Module({
	controllers: [
		PagesController,
		JobsController,
		BrandSearchController,
		SseController,
	],
	// BrandfetchModule exports BrandSearchPort so PRD 7's input-time autocomplete
	// consumes the same adapter Resolve uses (spec story 21).
	imports: [BrandfetchModule],
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
		{
			inject: [DB_CONNECTION],
			provide: RESOLVED_IDENTITY_READ_MODEL,
			useFactory: (c: DatabaseConnection) =>
				new DrizzleResolvedIdentityReadModel(c.db),
		},
		{
			inject: [DB_CONNECTION],
			provide: SUMMARY_READ_MODEL,
			useFactory: (c: DatabaseConnection) => new DrizzleSummaryReadModel(c.db),
		},
		{
			inject: [REDIS_CONNECTION],
			provide: JOB_EVENT_SUBSCRIBER,
			useFactory: (r: Redis) => new RedisEventSubscriber(r),
		},
		ConnectionsLifecycle,
		OtelLifecycle,
	],
})
export class AppWebModule {}
