import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSdk, shouldIgnoreRoute } from "./sdk";

describe("buildSdk", () => {
	const saved = { ...process.env };
	beforeEach(() => {
		delete process.env.OTEL_SDK_DISABLED;
		process.env.OTEL_SERVICE_NAME = "breakbeat-worker";
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
	});
	afterEach(() => {
		process.env = { ...saved };
	});

	it("returns null (SDK not started) when OTEL_SDK_DISABLED=true", () => {
		process.env.OTEL_SDK_DISABLED = "true";
		expect(buildSdk()).toBeNull();
	});

	it("returns a NodeSDK when enabled", () => {
		const sdk = buildSdk();
		expect(sdk).not.toBeNull();
		expect(typeof sdk?.start).toBe("function");
		expect(typeof sdk?.shutdown).toBe("function");
	});
});

describe("shouldIgnoreRoute (the auto-instrumentation ignore hook)", () => {
	it("ignores the SSE stream route", () => {
		expect(shouldIgnoreRoute("/jobs/abc-123/stream")).toBe(true);
		expect(shouldIgnoreRoute("/jobs/abc-123/stream?cursor=5")).toBe(true);
	});

	it("ignores the Terminus health route", () => {
		expect(shouldIgnoreRoute("/health")).toBe(true);
	});

	it("does NOT ignore ordinary routes (POST /jobs and GET /jobs/:id)", () => {
		expect(shouldIgnoreRoute("/jobs")).toBe(false);
		expect(shouldIgnoreRoute("/jobs/abc-123")).toBe(false);
	});
});
