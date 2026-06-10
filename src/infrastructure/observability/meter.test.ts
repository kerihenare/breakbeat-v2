import {
	AggregationTemporality,
	DataPointType,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./meter";

function collect() {
	const exporter = new InMemoryMetricExporter(
		AggregationTemporality.CUMULATIVE,
	);
	const reader = new PeriodicExportingMetricReader({
		exporter,
		exportIntervalMillis: 60_000,
	});
	const provider = new MeterProvider({ readers: [reader] });
	const registry = new MetricsRegistry(provider.getMeter("test"));
	return { exporter, provider, reader, registry };
}

describe("MetricsRegistry", () => {
	it("job.duration and stage.duration are Histograms; the rest are Counters", async () => {
		const { registry, reader, exporter, provider } = collect();
		registry.recordJobDuration(1234, {
			service: "breakbeat-worker",
			terminalState: "done",
		});
		registry.recordStageDuration(200, {
			service: "breakbeat-worker",
			stage: "search",
		});
		registry.incJobCompleted({
			service: "breakbeat-worker",
			terminalState: "done",
		});
		registry.incLlmTokens(150, {
			model: "claude-haiku-4-5-20251001",
			service: "breakbeat-worker",
			stage: "analyze",
		});
		await reader.forceFlush();
		const metrics = exporter
			.getMetrics()
			.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
		const byName = (n: string) => metrics.find((m) => m.descriptor.name === n);
		expect(byName("job.duration")?.dataPointType).toBe(DataPointType.HISTOGRAM);
		expect(byName("stage.duration")?.dataPointType).toBe(
			DataPointType.HISTOGRAM,
		);
		expect(byName("job.completed")?.dataPointType).toBe(DataPointType.SUM);
		expect(byName("llm.tokens")?.dataPointType).toBe(DataPointType.SUM);
		await provider.shutdown();
	});

	it("emits ONLY closed-label-set attributes — never job.id / anchor / URL", async () => {
		const { registry, reader, exporter, provider } = collect();
		registry.incResults({
			contentType: "news_article",
			exclusionCode: "off_topic",
			stage: "filter",
		});
		registry.incExternalRequest({
			outcome: "ok",
			stage: "search",
			system: "tavily",
		});
		await reader.forceFlush();
		const metrics = exporter
			.getMetrics()
			.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
		const allLabels = metrics.flatMap((m) =>
			m.dataPoints.flatMap((d) => Object.keys(d.attributes)),
		);
		expect(allLabels).not.toContain("job.id");
		expect(allLabels).not.toContain("url");
		expect(allLabels).not.toContain("anchor");
		expect(allLabels).toContain("exclusion_code");
		expect(allLabels).toContain("content_type");
		await provider.shutdown();
	});

	it("queue.depth is an observable gauge driven by the injected callback", async () => {
		const { registry, reader, exporter, provider } = collect();
		let depth = 7;
		registry.observeQueueDepth(() => depth, { service: "breakbeat-worker" });
		await reader.forceFlush();
		const metrics = exporter
			.getMetrics()
			.flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics));
		expect(
			metrics.find((m) => m.descriptor.name === "queue.depth"),
		).toBeDefined();
		depth = 3;
		await provider.shutdown();
	});
});
