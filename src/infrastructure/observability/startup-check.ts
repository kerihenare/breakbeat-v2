type Env = { OTEL_SDK_DISABLED?: string; OTEL_EXPORTER_OTLP_ENDPOINT?: string };

/**
 * Emits a startup warning when telemetry is disabled or the OTLP endpoint is
 * unset, so a production process can never silently run blind. `warn` is
 * injected (the logger in production; a spy in tests).
 */
export function warnIfBlind(env: Env, warn: (msg: string) => void): void {
	if (env.OTEL_SDK_DISABLED === "true") {
		warn(
			"[otel] OTEL_SDK_DISABLED=true — telemetry is OFF; this process is running blind.",
		);
		return;
	}
	if (
		!env.OTEL_EXPORTER_OTLP_ENDPOINT ||
		env.OTEL_EXPORTER_OTLP_ENDPOINT.trim() === ""
	) {
		warn(
			"[otel] OTEL_EXPORTER_OTLP_ENDPOINT is unset — traces/metrics/logs cannot be exported.",
		);
	}
}
