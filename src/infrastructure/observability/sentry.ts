import * as Sentry from "@sentry/nestjs";

/**
 * The Sentry/Bugsink config. `tracesSampleRate` is FIXED at 0 — Bugsink cannot
 * ingest spans, and the OTel NodeSDK is the single tracer-provider owner.
 * `skipOpenTelemetrySetup` keeps Sentry from registering its own OTel provider
 * or propagator, so the W3C traceparent the enqueue→worker link relies on stays
 * intact. Sentry contributes ERRORS ONLY (the three-signal split, ADR 0004).
 */
export function sentryConfig(dsn: string): Sentry.NodeOptions {
	return {
		dsn,
		skipOpenTelemetrySetup: true,
		tracesSampleRate: 0,
	} satisfies Sentry.NodeOptions;
}

/** Initialise Bugsink error reporting. A blank DSN disables it; the app still boots. */
export function initSentry(dsn: string | undefined): void {
	if (!dsn || dsn.trim() === "") return;
	Sentry.init(sentryConfig(dsn));
}

/** Feed a genuine failure to Bugsink. Called ONLY from the runJob failure branch. */
export function reportFailure(error: unknown): void {
	Sentry.captureException(
		error instanceof Error ? error : new Error(String(error)),
	);
}
