import {
	context,
	propagation,
	type Span,
	type SpanContext,
	trace,
} from "@opentelemetry/api";
import { PIPELINE_TRACER_NAME } from "./tracer";

/**
 * PRODUCER side (breakbeat-web). Writes the active context's traceparent (+
 * tracestate) into the BullMQ job data via the W3C propagator. The enqueue
 * happens inside the POST /jobs HTTP span, so the injected traceparent points
 * at that enqueue span.
 */
export function injectTraceparent(jobData: Record<string, unknown>): void {
	propagation.inject(context.active(), jobData);
}

/**
 * WORKER side (breakbeat-worker). Extracts the carried traceparent, derives the
 * enqueue SpanContext, and starts a NEW ROOT span `job.pipeline` carrying
 * exactly one LINK back to the enqueue span — NEVER a continuation. A continued
 * trace would fold dead queue-wait into the measured pipeline duration. Runs
 * `fn` inside the new root span's context.
 */
export async function startJobPipelineSpan<T>(
	jobData: Record<string, unknown>,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	const extracted = propagation.extract(context.active(), jobData);
	const enqueueSpanContext: SpanContext | undefined =
		trace.getSpanContext(extracted);
	const tracer = trace.getTracer(PIPELINE_TRACER_NAME);

	return tracer.startActiveSpan(
		"job.pipeline",
		{
			links: enqueueSpanContext ? [{ context: enqueueSpanContext }] : [],
			root: true,
		},
		async (span) => {
			// The helper OWNS the span lifecycle — the caller's fn drives the
			// pipeline and never touches the span. Ending here (after fn settles) is
			// what makes the span export; runJob has already set its OK/ERROR status
			// (via the active span) by the time fn returns.
			try {
				return await fn(span);
			} finally {
				span.end();
			}
		},
	);
}
