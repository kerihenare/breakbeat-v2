import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseConnection {
	readonly db: Database;
	readonly client: postgres.Sql;
}

/** Open a Drizzle/postgres-js connection. The caller owns its lifecycle. */
export function createDatabase(url: string, max = 10): DatabaseConnection {
	// Swallow routine NOTICEs (e.g. TRUNCATE … CASCADE) so they don't spam logs.
	const client = postgres(url, { max, onnotice: () => {} });
	const db = drizzle(client, { schema });
	return { client, db };
}
