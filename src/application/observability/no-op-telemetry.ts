import type {
	ExternalSystem,
	GenAiCall,
	PipelineTelemetry,
	ResultEvent,
} from "./pipeline-telemetry.port";

/**
 * The bound PipelineTelemetry when OTEL_SDK_DISABLED=true, and the default in
 * unit tests that do not assert telemetry. Every method is a cheap pass-through
 * so the pipeline is byte-for-byte identical with telemetry off. Unwraps
 * genAiCall's { value, call } to value, discarding the metadata.
 */
export class NoOpTelemetry implements PipelineTelemetry {
	async externalCall<T>(
		_system: ExternalSystem,
		_op: string,
		fn: () => Promise<T>,
	): Promise<T> {
		return fn();
	}

	async genAiCall<T>(
		_op: string,
		fn: () => Promise<{ value: T; call: GenAiCall }>,
	): Promise<T> {
		const { value } = await fn();
		return value;
	}

	recordResultEvent(_event: ResultEvent): void {
		// intentionally empty
	}
}
