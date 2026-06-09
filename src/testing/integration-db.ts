import { sql } from "drizzle-orm";
import {
	createDatabase,
	type Database,
	type DatabaseConnection,
} from "../infrastructure/persistence/database";

/**
 * The dedicated test database on the shared dev-compose Postgres (ADR 0008).
 * Integration tests isolate by truncating between tests rather than spinning up
 * a fresh container each. Requires `docker compose up postgres` + migrations.
 */
export const TEST_DATABASE_URL =
	process.env.TEST_DATABASE_URL ??
	"postgres://breakbeat:breakbeat@localhost:5432/breakbeat_test";

let connection: DatabaseConnection | null = null;

export function getTestDatabase(): Database {
	if (!connection) {
		connection = createDatabase(TEST_DATABASE_URL, 5);
	}
	return connection.db;
}

/** Truncate every table (CASCADE flows through the job_id FKs). */
export async function truncateAll(): Promise<void> {
	await getTestDatabase().execute(
		sql`TRUNCATE TABLE jobs RESTART IDENTITY CASCADE`,
	);
}

export async function closeTestDatabase(): Promise<void> {
	if (connection) {
		await connection.client.end({ timeout: 5 });
		connection = null;
	}
}
