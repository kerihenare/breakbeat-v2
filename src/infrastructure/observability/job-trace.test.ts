import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectTraceparent, startJobPipelineSpan } from "./job-trace";

describe("job-trace topology (link, never continue)", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let contextManager: AsyncLocalStorageContextManager;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);
		// The NodeSDK registers a context manager at runtime; tests must too, or
		// startActiveSpan can't propagate the span into context.active().
		contextManager = new AsyncLocalStorageContextManager();
		contextManager.enable();
		context.setGlobalContextManager(contextManager);
		// The NodeSDK registers the W3C propagator at runtime; without it
		// propagation.inject is a no-op and no traceparent is written.
		propagation.setGlobalPropagator(new W3CTraceContextPropagator());
	});
	afterEach(async () => {
		await provider.shutdown();
		contextManager.disable();
		trace.disable();
		context.disable();
		propagation.disable();
	});

	it("worker opens a job.pipeline ROOT span linked to the enqueue span — different trace_id, one link", async () => {
		const tracer = trace.getTracer("test");
		const jobData: Record<string, unknown> = { jobId: "abc-123" };

		let enqueueTraceId = "";
		await tracer.startActiveSpan("POST /jobs", async (enqueueSpan) => {
			enqueueTraceId = enqueueSpan.spanContext().traceId;
			injectTraceparent(jobData);
			enqueueSpan.end();
		});
		expect(typeof jobData.traceparent).toBe("string");

		let pipelineTraceId = "";
		// The fn does NOT end the span — the helper owns the lifecycle and must end
		// it so it exports (a real worker's fn ignores the span entirely).
		await startJobPipelineSpan(jobData, async (span) => {
			pipelineTraceId = span.spanContext().traceId;
		});

		const pipeline = exporter
			.getFinishedSpans()
			.find((s) => s.name === "job.pipeline");
		expect(pipeline).toBeDefined();
		const linkTraceIds = (pipeline?.links ?? []).map((l) => l.context.traceId);

		expect(pipelineTraceId).not.toBe(enqueueTraceId); // LINK, not continuation
		expect(linkTraceIds).toEqual([enqueueTraceId]); // exactly one link, back to enqueue
		expect(pipeline?.parentSpanContext).toBeUndefined(); // it is a root span
	});

	it("one Job yields exactly one job.pipeline span", async () => {
		const jobData: Record<string, unknown> = { jobId: "abc-123" };
		injectTraceparent(jobData);
		await startJobPipelineSpan(jobData, async () => {});
		const pipelines = exporter
			.getFinishedSpans()
			.filter((s) => s.name === "job.pipeline");
		expect(pipelines).toHaveLength(1);
	});
});
