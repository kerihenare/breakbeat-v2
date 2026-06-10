import type { JobObserver, TerminalState } from "./job-observer.port";

/** The bound JobObserver in unit tests + when telemetry is off. Cheap pass-throughs. */
export class NoOpJobObserver implements JobObserver {
	onTerminal(_state: TerminalState, _durationMs: number): void {
		// intentionally empty
	}

	onFailure(_error: unknown): void {
		// intentionally empty
	}
}
