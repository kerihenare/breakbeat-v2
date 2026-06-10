import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nestjs", () => ({
	captureException: vi.fn(),
	init: vi.fn(),
}));

import * as Sentry from "@sentry/nestjs";
import { MetricsRegistry } from "./meter";
import { OtelJobObserver } from "./otel-job-observer";

describe("OtelJobObserver", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let metrics: MetricsRegistry;
	let contextManager: AsyncLocalStorageContextManager;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);
		contextManager = new AsyncLocalStorageContextManager();
		contextManager.enable();
		context.setGlobalContextManager(contextManager);
		metrics = new MetricsRegistry(new MeterProvider().getMeter("test"));
		vi.clearAllMocks();
	});
	afterEach(async () => {
		await provider.shutdown();
		contextManager.disable();
		trace.disable();
		context.disable();
	});

	it("marks the active job.pipeline span ERROR for a failed Job", async () => {
		const observer = new OtelJobObserver(metrics, "breakbeat-worker");
		await trace.getTracer("t").startActiveSpan("job.pipeline", async (span) => {
			observer.onTerminal("failed", 1000);
			span.end();
		});
		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "job.pipeline");
		expect(span?.status.code).toBe(SpanStatusCode.ERROR);
		expect(span?.attributes["job.terminal_state"]).toBe("failed");
	});

	it("marks the active span OK for done / done_with_warnings (a Warning is not a span error)", async () => {
		const observer = new OtelJobObserver(metrics, "breakbeat-worker");
		await trace.getTracer("t").startActiveSpan("job.pipeline", async (span) => {
			observer.onTerminal("done_with_warnings", 500);
			span.end();
		});
		const span = exporter
			.getFinishedSpans()
			.find((s) => s.name === "job.pipeline");
		expect(span?.status.code).toBe(SpanStatusCode.OK);
	});

	it("feeds a failure to Bugsink via captureException", () => {
		new OtelJobObserver(metrics, "breakbeat-worker").onFailure(
			new Error("all search queries failed"),
		);
		expect(Sentry.captureException).toHaveBeenCalledOnce();
	});
});
