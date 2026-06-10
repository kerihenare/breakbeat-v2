import type { Clock } from "../application/ports/clock.port";
import type { IdGenerator } from "../application/ports/id-generator.port";
import type {
	JobEventPublisher,
	JobNudge,
} from "../application/ports/job-event-publisher.port";
import type {
	JobEnqueueMessage,
	JobQueue,
} from "../application/ports/job-queue.port";
import type { JobRepository } from "../application/ports/job-repository.port";
import { Job, type JobSnapshot } from "../domain/job/job";

/** In-memory JobRepository fake. Stores snapshots so callers can't alias state. */
export class FakeJobRepository implements JobRepository {
	private readonly store = new Map<string, JobSnapshot>();
	readonly savedStates: string[] = [];
	readonly deletedIds: string[] = [];

	async save(job: Job): Promise<void> {
		this.store.set(job.id, job.toSnapshot());
		this.savedStates.push(job.state);
	}

	async findById(id: string): Promise<Job | null> {
		const snapshot = this.store.get(id);
		return snapshot ? Job.fromPersistence(snapshot) : null;
	}

	async delete(id: string): Promise<void> {
		this.store.delete(id);
		this.deletedIds.push(id);
	}

	get count(): number {
		return this.store.size;
	}
}

export class FakeJobQueue implements JobQueue {
	readonly enqueued: JobEnqueueMessage[] = [];
	/** When set, the next `enqueue` rejects with this error (simulates Redis down). */
	failNext: Error | null = null;

	async enqueue(message: JobEnqueueMessage): Promise<void> {
		if (this.failNext) {
			const error = this.failNext;
			this.failNext = null;
			throw error;
		}
		this.enqueued.push(message);
	}
}

export class FakeEventPublisher implements JobEventPublisher {
	readonly published: JobNudge[] = [];

	async publish(nudge: JobNudge): Promise<void> {
		this.published.push(nudge);
	}
}

export class FixedClock implements Clock {
	constructor(private readonly fixed = new Date("2026-06-10T00:00:00.000Z")) {}

	now(): Date {
		return this.fixed;
	}
}

export class SequenceIdGenerator implements IdGenerator {
	private counter = 0;

	constructor(private readonly prefix = "job") {}

	uuidv7(): string {
		this.counter += 1;
		return `${this.prefix}-${this.counter}`;
	}
}
