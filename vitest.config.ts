import { defineConfig } from "vitest/config";

// Unit tier (ADR 0008): *.test.ts only, no I/O. Hermetic — part of `pnpm verify`.
// *.integration.test.ts (compose Postgres/Redis) and *.e2e.ts (Playwright) are excluded.
export default defineConfig({
	test: {
		// Unit tests run with telemetry OFF, exactly as CI does (PRD 8): importing
		// instrumentation.ts is then a safe no-op and the pipeline is byte-identical.
		env: { OTEL_SDK_DISABLED: "true" },
		environment: "node",
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/*.integration.test.ts",
			"**/*.e2e.ts",
		],
		globals: true,
		include: ["src/**/*.test.ts"],
	},
});
