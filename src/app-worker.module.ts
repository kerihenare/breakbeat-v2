import { Module } from "@nestjs/common";
import type { Stage } from "./application/pipeline/stage.port";
import { STAGES } from "./application/pipeline/stage.port";
import { StageRunner } from "./application/pipeline/stage-runner";
import type { Clock } from "./application/ports/clock.port";
import { CLOCK } from "./application/ports/clock.port";
import type { JobEventPublisher } from "./application/ports/job-event-publisher.port";
import { JOB_EVENT_PUBLISHER } from "./application/ports/job-event-publisher.port";
import type { JobRepository } from "./application/ports/job-repository.port";
import { JOB_REPOSITORY } from "./application/ports/job-repository.port";
import { RunJobUseCase } from "./application/run-job.usecase";
import type { Env } from "./config/env";
import type { DatabaseConnection } from "./infrastructure/persistence/database";
import { DemoStage } from "./infrastructure/pipeline/demo.stage";
import { ConnectionsLifecycle } from "./interface/connections.lifecycle";
import { coreProviders } from "./interface/core.providers";
import {
	DB_CONNECTION,
	ENV,
	RUN_JOB,
	STAGE_RUNNER,
} from "./interface/di-tokens";
import { JobWorkerService } from "./interface/job-worker.service";

/** The worker DI graph: the consumer side + the stage runner (no HTTP surface). */
@Module({
	providers: [
		...coreProviders,
		{
			inject: [ENV, DB_CONNECTION],
			// Foundation registers an empty stage list (or the throwaway demo stage
			// when DEMO_STAGE=true). PRDs 2–6 register the real stages here in order.
			provide: STAGES,
			useFactory: (env: Env, c: DatabaseConnection): Stage[] =>
				env.DEMO_STAGE ? [new DemoStage(c.db)] : [],
		},
		{
			inject: [STAGES],
			provide: STAGE_RUNNER,
			useFactory: (stages: Stage[]) => new StageRunner(stages),
		},
		{
			inject: [JOB_REPOSITORY, JOB_EVENT_PUBLISHER, CLOCK, STAGE_RUNNER],
			provide: RUN_JOB,
			useFactory: (
				jobs: JobRepository,
				publisher: JobEventPublisher,
				clock: Clock,
				runner: StageRunner,
			) => new RunJobUseCase(jobs, publisher, clock, runner),
		},
		JobWorkerService,
		ConnectionsLifecycle,
	],
})
export class AppWorkerModule {}
