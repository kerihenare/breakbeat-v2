/**
 * OpenTelemetry bootstrap seam (ADR 0004).
 *
 * Loaded via `node --import ./dist/instrumentation.js` on BOTH entrypoints
 * (breakbeat-web and breakbeat-worker), before any application module is
 * imported. This is the load-before-app-modules ordering ADR 0004 / PRD 8
 * depend on.
 *
 * PRD 1 (Foundation) ships this as an EMPTY seam: it establishes the process
 * boundary and bootstrap order, but does not yet register the OTel Node SDK,
 * the enqueue→worker span link, metrics, or the otel-lgtm/Bugsink split.
 * Those land in PRD 8. Do not add tracing logic here without ADR 0004.
 */

// Intentionally empty in PRD 1. See docs/adr/0004-otel-instrumentation.md.
export {};
