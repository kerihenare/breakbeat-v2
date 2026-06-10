import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	AlwaysOnSampler,
	BatchSpanProcessor,
	ParentBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const SSE_ROUTE = /^\/jobs\/[^/]+\/stream(\?.*)?$/;
const HEALTH_ROUTE = /^\/health(\?.*)?$/;

/** Route hygiene: the SSE stream + Terminus health routes are excluded from HTTP span creation. */
export function shouldIgnoreRoute(path: string): boolean {
	return SSE_ROUTE.test(path) || HEALTH_ROUTE.test(path);
}

/**
 * Builds the single NodeSDK — the ONLY tracer-provider owner. Returns null when
 * OTEL_SDK_DISABLED=true (the SDK is never started; the bound PipelineTelemetry
 * is the no-op). Fail-soft: the OTLP exporters retry then drop on a down/
 * unreachable Collector and never throw into the pipeline; the BatchSpanProcessor
 * exports asynchronously off the hot path.
 */
export function buildSdk(): NodeSDK | null {
	if (process.env.OTEL_SDK_DISABLED === "true") return null;

	const endpoint =
		process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
	const serviceName = process.env.OTEL_SERVICE_NAME ?? "breakbeat";

	return new NodeSDK({
		instrumentations: [
			getNodeAutoInstrumentations({
				"@opentelemetry/instrumentation-http": {
					ignoreIncomingRequestHook: (req) => shouldIgnoreRoute(req.url ?? ""),
				},
			}),
		],
		metricReader: new PeriodicExportingMetricReader({
			exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
		}),
		resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
		sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
		spanProcessors: [
			new BatchSpanProcessor(
				new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
			),
		],
	});
}
