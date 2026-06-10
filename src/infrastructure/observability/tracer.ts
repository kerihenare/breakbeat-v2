import { context, type Span, trace } from "@opentelemetry/api";

export const PIPELINE_TRACER_NAME = "breakbeat-pipeline";

/** The single tracer used by every manual pipeline span. No-op when the SDK is off. */
export const pipelineTracer = () => trace.getTracer(PIPELINE_TRACER_NAME);

/** The span currently active on the OTel context (the Stage Span inside a stage; else the job span). */
export function getActiveSpan(): Span | undefined {
	return trace.getSpan(context.active());
}
