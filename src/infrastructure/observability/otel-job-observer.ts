import { SpanStatusCode } from "@opentelemetry/api";
import type {
	JobObserver,
	TerminalState,
} from "../../application/observability/job-observer.port";
import { type MetricsRegistry, type ServiceLabel } from "./meter";
import { reportFailure } from "./sentry";
import { getActiveSpan } from "./tracer";

/**
 * The OTel impl of the job-level seam. Maps the terminal state to the
 * `job.pipeline` span status (a failed Job → ERROR; done / done_with_warnings →
 * OK, since Warnings are not span errors), records `job.duration` +
 * `job.completed`, and feeds failures to Bugsink. Degrades to a no-op when the
 * SDK is off (global no-op tracer/meter; a blank Sentry DSN).
 */
export class OtelJobObserver implements JobObserver {
	constructor(
		private readonly metrics: MetricsRegistry,
		private readonly service: ServiceLabel,
	) {}

	onTerminal(state: TerminalState, durationMs: number): void {
		const span = getActiveSpan();
		if (span) {
			span.setAttribute("job.terminal_state", state);
			span.setStatus(
				state === "failed"
					? { code: SpanStatusCode.ERROR }
					: { code: SpanStatusCode.OK },
			);
		}
		this.metrics.recordJobDuration(durationMs, {
			service: this.service,
			terminalState: state,
		});
		this.metrics.incJobCompleted({
			service: this.service,
			terminalState: state,
		});
	}

	onFailure(error: unknown): void {
		reportFailure(error);
	}
}
