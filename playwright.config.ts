import { defineConfig } from "@playwright/test";

// E2E tier (ADR 0008): the two-process spine (breakbeat-web + breakbeat-worker),
// the browser, SSE, and a11y. Files end in *.e2e.ts. Requires the dev compose
// stack (Postgres + Redis) to be up.
const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	expect: { timeout: 15_000 },
	fullyParallel: false,
	testDir: "./test/e2e",
	testMatch: /.*\.e2e\.ts$/,
	timeout: 60_000,
	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
	},
	// The web + worker processes are started by the suite's global setup
	// (both load the empty instrumentation seam via `node --import`).
	webServer: {
		command: "pnpm start:web",
		env: { DEMO_STAGE: "true", OTEL_SDK_DISABLED: "true" },
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		url: BASE_URL,
	},
	workers: 1,
});
