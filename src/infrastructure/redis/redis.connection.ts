import { Redis, type RedisOptions } from "ioredis";

/**
 * ioredis connection factory. `maxRetriesPerRequest: null` is required by BullMQ
 * for blocking commands; it is harmless for the pub/sub publisher too.
 */
export function createRedis(url: string, options: RedisOptions = {}): Redis {
	// maxRetriesPerRequest is applied last so a caller cannot override the
	// `null` value BullMQ requires for its blocking commands.
	return new Redis(url, { ...options, maxRetriesPerRequest: null });
}
