import {
	type Job as BullJob,
	Queue,
	type QueueOptions,
	Worker,
	type WorkerOptions,
} from "bullmq";
import type { Redis } from "ioredis";
import type {
	JobEnqueueMessage,
	JobQueue,
} from "../../application/ports/job-queue.port";
import type { RunJobUseCase } from "../../application/run-job.usecase";
import {
	injectTraceparent,
	startJobPipelineSpan,
} from "../observability/job-trace";

/** One queue; one BullMQ job per Breakbeat Job (ADR 0004 — not a per-stage flow). */
export const JOB_QUEUE_NAME = "breakbeat-pipeline";
const RUN_JOB = "run-job";

/** BullMQ producer adapter for the JobQueue port (web side). */
export class BullJobProducer implements JobQueue {
	constructor(private readonly queue: Queue) {}

	async enqueue(message: JobEnqueueMessage): Promise<void> {
		// Stamp the active context's W3C traceparent onto the job data so the
		// worker can LINK the job.pipeline span back to this enqueue (ADR 0004).
		const data: Record<string, unknown> = { ...message };
		injectTraceparent(data);
		// Use the Job id as the BullMQ job id so re-enqueue is idempotent and the
		// unit carries the id only.
		await this.queue.add(RUN_JOB, data, {
			jobId: message.jobId,
			removeOnComplete: true,
			removeOnFail: false,
		});
	}
}

export function createQueue(
	connection: Redis,
	options: Partial<QueueOptions> = {},
): Queue {
	return new Queue(JOB_QUEUE_NAME, { connection, ...options });
}

/**
 * BullMQ consumer (worker side). Claims the unit durably and invokes runJob;
 * BullMQ's reservation + default stalled-job handling means a worker restart
 * re-claims rather than double-runs.
 */
export function createJobWorker(
	connection: Redis,
	runJob: RunJobUseCase,
	options: Partial<WorkerOptions> = {},
): Worker {
	return new Worker(
		JOB_QUEUE_NAME,
		async (bullJob: BullJob<JobEnqueueMessage>) => {
			// Open the job.pipeline root span, linked (not continued) to the enqueue
			// span carried in the job data, and run the whole pipeline inside it.
			await startJobPipelineSpan(
				bullJob.data as unknown as Record<string, unknown>,
				() => runJob.execute(bullJob.data.jobId),
			);
		},
		{ concurrency: 1, connection, ...options },
	);
}
