import { defineConfig } from "vitest/config";

// Integration tier (ADR 0008): *.integration.test.ts against the dev compose
// Postgres/Redis. Requires `docker compose up`. NOT part of `pnpm verify`.
export default defineConfig({
	test: {
		environment: "node",
		exclude: ["**/node_modules/**", "**/dist/**"],
		globals: true,
		hookTimeout: 30000,
		include: ["src/**/*.integration.test.ts"],
		// Single-threaded: integration tests share one Postgres/Redis and isolate
		// by truncation; parallel pools would race on the same tables.
		pool: "forks",
		poolOptions: { forks: { singleFork: true } },
		testTimeout: 30000,
	},
});
