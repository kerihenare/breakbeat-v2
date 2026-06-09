/** The one unit of work enqueued per Job — carries the id only (ADR 0004). */
export interface JobEnqueueMessage {
	readonly jobId: string;
}

/** Producer port the submit use-case calls. Implemented by the BullMQ adapter. */
export interface JobQueue {
	enqueue(message: JobEnqueueMessage): Promise<void>;
}

export const JOB_QUEUE = Symbol("JobQueue");
