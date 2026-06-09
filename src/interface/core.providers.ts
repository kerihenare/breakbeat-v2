import type { Provider } from "@nestjs/common";
import type { Redis } from "ioredis";
import { CLOCK } from "../application/ports/clock.port";
import { ID_GENERATOR } from "../application/ports/id-generator.port";
import { JOB_EVENT_PUBLISHER } from "../application/ports/job-event-publisher.port";
import { JOB_REPOSITORY } from "../application/ports/job-repository.port";
import { type Env, loadEnv } from "../config/env";
import { RedisEventPublisher } from "../infrastructure/events/redis-event.publisher";
import {
	createDatabase,
	type DatabaseConnection,
} from "../infrastructure/persistence/database";
import { DrizzleJobRepository } from "../infrastructure/persistence/job.repository";
import { createRedis } from "../infrastructure/redis/redis.connection";
import { SystemClock } from "../infrastructure/system/system-clock";
import { UuidIdGenerator } from "../infrastructure/system/uuid-id-generator";
import { DB_CONNECTION, ENV, REDIS_CONNECTION } from "./di-tokens";

/** Providers shared by both the web and worker DI graphs. */
export const coreProviders: Provider[] = [
	{ provide: ENV, useFactory: () => loadEnv() },
	{
		inject: [ENV],
		provide: DB_CONNECTION,
		useFactory: (env: Env) => createDatabase(env.DATABASE_URL),
	},
	{
		inject: [ENV],
		provide: REDIS_CONNECTION,
		useFactory: (env: Env) => createRedis(env.REDIS_URL),
	},
	{
		inject: [DB_CONNECTION],
		provide: JOB_REPOSITORY,
		useFactory: (c: DatabaseConnection) => new DrizzleJobRepository(c.db),
	},
	{ provide: CLOCK, useClass: SystemClock },
	{ provide: ID_GENERATOR, useClass: UuidIdGenerator },
	{
		inject: [REDIS_CONNECTION],
		provide: JOB_EVENT_PUBLISHER,
		useFactory: (r: Redis) => new RedisEventPublisher(r),
	},
];
