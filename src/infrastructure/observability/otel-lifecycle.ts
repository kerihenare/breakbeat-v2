import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { otelSdk } from "../../instrumentation";

/**
 * Flushes the OTel SDK on shutdown so buffered spans/metrics export before the
 * process exits (the BatchSpanProcessor + PeriodicExportingMetricReader hold a
 * tail). A no-op when telemetry is off (otelSdk is null). Optional chaining
 * short-circuits the whole chain when null, so this never throws.
 */
@Injectable()
export class OtelLifecycle implements OnApplicationShutdown {
	async onApplicationShutdown(): Promise<void> {
		await otelSdk?.shutdown().catch(() => {});
	}
}
