/**
 * The job-level observability seam (ADR 0004). run-job calls this after a Job
 * reaches its terminal state — the OTel-free application layer never imports
 * `@opentelemetry/*`; the infrastructure impl maps the terminal state to the
 * `job.pipeline` span status, records the job metrics, and feeds genuine
 * failures to Bugsink. The no-op impl keeps the pipeline byte-identical.
 */
export type TerminalState = "done" | "done_with_warnings" | "failed";

export interface JobObserver {
	/** Map the Job's terminal state to the active span's status + the job metrics. */
	onTerminal(state: TerminalState, durationMs: number): void;
	/** Feed a genuine Job failure to the error sink (Bugsink). */
	onFailure(error: unknown): void;
}

export const JOB_OBSERVER = Symbol("JobObserver");
