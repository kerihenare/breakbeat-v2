import { defineConfig } from "drizzle-kit";

// drizzle-kit is a dev/migration tool — never bundled into the runtime (the app
// reads env.DATABASE_URL via loadEnv). The localhost fallback matches the
// documented docker-compose creds and keeps offline `migrate:generate` working,
// but outside production only: under NODE_ENV=production we require an explicit
// URL rather than silently pointing migrations at a guessed local database.
const DEV_FALLBACK_URL =
	"postgres://breakbeat:breakbeat@localhost:5432/breakbeat";

function resolveDatabaseUrl(): string {
	const url = process.env.DATABASE_URL;
	if (url) return url;
	if (process.env.NODE_ENV === "production") {
		throw new Error("DATABASE_URL must be set when NODE_ENV=production");
	}
	return DEV_FALLBACK_URL;
}

export default defineConfig({
	dbCredentials: { url: resolveDatabaseUrl() },
	dialect: "postgresql",
	out: "./drizzle",
	schema: "./src/infrastructure/persistence/schema.ts",
	strict: true,
	verbose: true,
});
