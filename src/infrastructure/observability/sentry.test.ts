import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: { options?: Record<string, unknown> } = {};
vi.mock("@sentry/nestjs", () => ({
	captureException: vi.fn(),
	init: vi.fn((options: Record<string, unknown>) => {
		captured.options = options;
	}),
}));

import * as Sentry from "@sentry/nestjs";
import { initSentry, reportFailure, sentryConfig } from "./sentry";

describe("Sentry wiring (single owner, errors only)", () => {
	beforeEach(() => {
		captured.options = undefined;
		vi.clearAllMocks();
	});

	it("configures tracesSampleRate: 0 (Bugsink cannot ingest spans)", () => {
		expect(sentryConfig("https://dsn@bugsink/1").tracesSampleRate).toBe(0);
	});

	it("does NOT register its own OTel setup (single tracer-provider owner)", () => {
		expect(sentryConfig("https://dsn@bugsink/1").skipOpenTelemetrySetup).toBe(
			true,
		);
	});

	it("does NOT initialise when the DSN is blank (app still boots)", () => {
		initSentry("");
		expect(Sentry.init).not.toHaveBeenCalled();
	});

	it("initialises with tracesSampleRate 0 when a DSN is present", () => {
		initSentry("https://dsn@bugsink/1");
		expect(Sentry.init).toHaveBeenCalledOnce();
		expect(captured.options?.tracesSampleRate).toBe(0);
	});

	it("Sentry init does not replace the global OTel tracer provider", () => {
		const provider = trace.getTracerProvider();
		initSentry("https://dsn@bugsink/1");
		expect(trace.getTracerProvider()).toBe(provider);
	});

	it("reportFailure feeds Bugsink with the error", () => {
		reportFailure(new Error("all search queries failed"));
		expect(Sentry.captureException).toHaveBeenCalledOnce();
		expect(
			(Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0][0],
		).toBeInstanceOf(Error);
	});
});
