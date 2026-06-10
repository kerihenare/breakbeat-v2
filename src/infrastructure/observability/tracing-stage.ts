import { SpanStatusCode } from "@opentelemetry/api";
import type { RunContext } from "../../application/pipeline/run-context";
import type { Stage } from "../../application/pipeline/stage.port";
import {
	type MetricsRegistry,
	type ServiceLabel,
	type StageLabel,
} from "./meter";
import { pipelineTracer } from "./tracer";

/** The closed Stage Span name set (ADR 0004 metric labels); other names get a span but no metric. */
const STAGE_LABELS = new Set<string>([
	"resolve",
	"search",
	"filter",
	"analyze",
	"summarise",
]);

/**
 * Decorates a Stage with a Stage Span (ADR 0004): opens a span named the
 * stage's name, makes it the active context (so an adapter's child spans nest
 * under it), times it, sets status — a stage throw → ERROR + recordException;
 * returning normally (with or without Warnings) → OK, since a Warning is an OK
 * span event, not a span error — records the `stage.duration` metric, and ends.
 *
 * It never changes the stage's policy: it re-throws exactly what the stage threw,
 * so the StageRunner's warn-vs-fail mechanism is untouched. With telemetry off
 * the tracer/meter are the global no-ops → behaviour is byte-identical.
 */
export class TracingStage implements Stage {
	constructor(
		private readonly inner: Stage,
		private readonly metrics: MetricsRegistry,
		private readonly service: ServiceLabel,
	) {}

	get name(): string {
		return this.inner.name;
	}

	async run(ctx: RunContext): Promise<void> {
		const startedAt = Date.now();
		await pipelineTracer().startActiveSpan(this.inner.name, async (span) => {
			try {
				await this.inner.run(ctx);
				span.setStatus({ code: SpanStatusCode.OK });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				span.setStatus({ code: SpanStatusCode.ERROR, message });
				if (error instanceof Error) span.recordException(error);
				throw error;
			} finally {
				if (STAGE_LABELS.has(this.inner.name)) {
					this.metrics.recordStageDuration(Date.now() - startedAt, {
						service: this.service,
						stage: this.inner.name as StageLabel,
					});
				}
				span.end();
			}
		});
	}
}
