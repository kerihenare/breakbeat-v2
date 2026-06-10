import { SpanStatusCode, trace } from "@opentelemetry/api";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunContext } from "../../application/pipeline/run-context";
import type { Stage } from "../../application/pipeline/stage.port";
import { MetricsRegistry } from "./meter";
import { TracingStage } from "./tracing-stage";

const ctx = {} as RunContext;

describe("TracingStage", () => {
	let exporter: InMemorySpanExporter;
	let provider: BasicTracerProvider;
	let metrics: MetricsRegistry;

	beforeEach(() => {
		exporter = new InMemorySpanExporter();
		provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		trace.setGlobalTracerProvider(provider);
		metrics = new MetricsRegistry(new MeterProvider().getMeter("test"));
	});
	afterEach(async () => {
		await provider.shutdown();
		trace.disable();
	});

	it("opens one Stage Span named by the stage, with OK status when the stage returns", async () => {
		const inner: Stage = { name: "search", run: async () => {} };
		await new TracingStage(inner, metrics, "breakbeat-worker").run(ctx);
		const spans = exporter
			.getFinishedSpans()
			.filter((s) => s.name === "search");
		expect(spans).toHaveLength(1);
		expect(spans[0].status.code).toBe(SpanStatusCode.OK);
	});

	it("sets ERROR status + re-throws when the stage throws (policy preserved)", async () => {
		const boom = new Error("stage failed");
		const inner: Stage = {
			name: "filter",
			run: async () => {
				throw boom;
			},
		};
		await expect(
			new TracingStage(inner, metrics, "breakbeat-worker").run(ctx),
		).rejects.toThrow("stage failed");
		const span = exporter.getFinishedSpans().find((s) => s.name === "filter");
		expect(span?.status.code).toBe(SpanStatusCode.ERROR);
		expect(span?.events.some((e) => e.name === "exception")).toBe(true);
	});

	it("preserves the stage's name", () => {
		const inner: Stage = { name: "resolve", run: async () => {} };
		expect(new TracingStage(inner, metrics, "breakbeat-worker").name).toBe(
			"resolve",
		);
	});
});
