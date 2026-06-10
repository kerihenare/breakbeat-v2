import { Controller, Inject, Param, Sse } from "@nestjs/common";
import { Observable } from "rxjs";
import {
	JOB_EVENT_SUBSCRIBER,
	type JobEventSubscriber,
} from "../../application/ports/job-event-subscriber.port";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../../application/ports/job-repository.port";
import {
	RESULTS_READ_MODEL,
	type ResultsReadModel,
} from "../../application/ports/read-models.port";
import { buildStreamFrame } from "./result.presenter";

/** NestJS @Sse duck-types this; `type` becomes the SSE event name. */
interface SseMessage {
	data: string | object;
	type?: string;
}

const PAGE_SIZE = 20;
// Coalesce a burst of nudges (a stage commits many Results at once) into one re-read.
const COALESCE_MS = 120;

/**
 * The live Result stream (ADR 0006/0007). Subscribes to the Job's Redis nudge
 * channel; on each committed-write nudge it re-reads page-1 + status and emits a
 * `snapshot` frame (the canonical server-rendered list + badge — parity with the
 * page). It pushes one snapshot on connect (so a reconnecting client re-syncs)
 * and completes the stream at the terminal state. NestJS tears the Observable
 * down on client disconnect, which releases the subscriber connection.
 */
@Controller()
export class SseController {
	constructor(
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(RESULTS_READ_MODEL) private readonly results: ResultsReadModel,
		@Inject(JOB_EVENT_SUBSCRIBER)
		private readonly subscriber: JobEventSubscriber,
	) {}

	@Sse("jobs/:id/stream")
	stream(@Param("id") id: string): Observable<SseMessage> {
		return new Observable<SseMessage>((observer) => {
			let closed = false;
			let timer: ReturnType<typeof setTimeout> | null = null;
			let teardown: (() => Promise<void>) | null = null;

			const pushSnapshot = async (): Promise<void> => {
				if (closed) return;
				const job = await this.jobs.findById(id);
				if (!job) {
					observer.complete();
					return;
				}
				const included = await this.results.includedPage(id, 1, PAGE_SIZE);
				const frame = buildStreamFrame(job, included);
				observer.next({ data: frame, type: "snapshot" });
				if (frame.isTerminal) observer.complete();
			};

			const onNudge = (): void => {
				if (timer) return; // a burst coalesces into the already-scheduled re-read
				timer = setTimeout(() => {
					timer = null;
					void pushSnapshot();
				}, COALESCE_MS);
			};

			void (async () => {
				await pushSnapshot();
				if (closed) return;
				teardown = await this.subscriber.subscribe(id, onNudge);
			})();

			return () => {
				closed = true;
				if (timer) clearTimeout(timer);
				if (teardown) void teardown();
			};
		});
	}
}
