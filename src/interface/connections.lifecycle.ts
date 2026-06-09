import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { DatabaseConnection } from "../infrastructure/persistence/database";
import { DB_CONNECTION, REDIS_CONNECTION } from "./di-tokens";

/** Closes the shared Postgres and Redis connections on shutdown (after app close). */
@Injectable()
export class ConnectionsLifecycle implements OnApplicationShutdown {
	constructor(
		@Inject(DB_CONNECTION) private readonly db: DatabaseConnection,
		@Inject(REDIS_CONNECTION) private readonly redis: Redis,
	) {}

	async onApplicationShutdown(): Promise<void> {
		await this.db.client.end({ timeout: 5 }).catch(() => {});
		await this.redis.quit().catch(() => {});
	}
}
