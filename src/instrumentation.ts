/**
 * OpenTelemetry bootstrap seam (ADR 0004).
 *
 * Loaded via `node --import ./dist/instrumentation.js` on BOTH entrypoints
 * (breakbeat-web and breakbeat-worker), before any application module is
 * imported, so auto-instrumentation patches Express/ioredis/pg/undici before
 * they are required.
 *
 * PRD 8 turns this on: it builds the single NodeSDK (the only tracer-provider
 * owner), warns if the process is running blind, and exposes the SDK instance so
 * the shutdown sequence can flush it. Returns null + stays off under
 * OTEL_SDK_DISABLED=true — the bound PipelineTelemetry is then the no-op and the
 * pipeline is byte-identical.
 */
import { buildSdk } from "./infrastructure/observability/sdk";
import { initSentry } from "./infrastructure/observability/sentry";
import { warnIfBlind } from "./infrastructure/observability/startup-check";

// pino is not yet wired this early; stdout is the floor.
warnIfBlind(process.env, (msg) => console.warn(msg));

// Errors-only Bugsink feed. skipOpenTelemetrySetup keeps it from owning a
// tracer provider, so the OTel SDK below is the single owner. A blank DSN is a
// no-op (the app still boots).
initSentry(process.env.SENTRY_DSN);

const sdk = buildSdk();
sdk?.start();

// Exposed so the shutdown sequence can flush this exact instance.
export const otelSdk = sdk;
