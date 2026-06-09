import type { CompanyAnchor } from "./company-anchor";
import { IllegalTransitionError } from "./job-errors";
import type { JobState } from "./job-state";
import type { Warning } from "./warning";

/** A point-in-time snapshot of a Job's durable facts (persisted / reconstituted). */
export interface JobSnapshot {
	readonly id: string;
	readonly anchor: CompanyAnchor;
	readonly state: JobState;
	readonly warnings: readonly Warning[];
	readonly createdAt: Date;
	readonly startedAt: Date | null;
	readonly terminalAt: Date | null;
	readonly failureReason: string | null;
}

/**
 * The Job aggregate — the deep core (PRD 1). Behavioural interface, no public
 * setters: callers cannot push it into an illegal state. It owns the single
 * warning list, and derives `done` vs `done_with_warnings` from that list at
 * `complete` — never a caller's choice. Terminal states are absorbing.
 */
export class Job {
	private _state: JobState;
	private readonly _warnings: Warning[];
	private _startedAt: Date | null;
	private _terminalAt: Date | null;
	private _failureReason: string | null;

	readonly id: string;
	readonly anchor: CompanyAnchor;
	readonly createdAt: Date;

	private constructor(s: JobSnapshot) {
		this.id = s.id;
		this.anchor = s.anchor;
		this.createdAt = s.createdAt;
		this._state = s.state;
		this._warnings = [...s.warnings];
		this._startedAt = s.startedAt;
		this._terminalAt = s.terminalAt;
		this._failureReason = s.failureReason;
	}

	/** Create a fresh `pending` Job from a company anchor. */
	static create(id: string, anchor: CompanyAnchor, now: Date): Job {
		return new Job({
			anchor,
			createdAt: now,
			failureReason: null,
			id,
			startedAt: null,
			state: "pending",
			terminalAt: null,
			warnings: [],
		});
	}

	/** Rebuild from a stored row WITHOUT re-running transitions. */
	static fromPersistence(snapshot: JobSnapshot): Job {
		return new Job(snapshot);
	}

	get state(): JobState {
		return this._state;
	}

	/** A defensive copy — the aggregate owns the only mutable warning list. */
	get warnings(): readonly Warning[] {
		return [...this._warnings];
	}

	get startedAt(): Date | null {
		return this._startedAt;
	}

	get terminalAt(): Date | null {
		return this._terminalAt;
	}

	get failureReason(): string | null {
		return this._failureReason;
	}

	/** `pending → running`. Illegal from any other state. */
	start(now: Date): void {
		if (this._state !== "pending")
			throw new IllegalTransitionError(this._state, "start");
		this._state = "running";
		this._startedAt = now;
	}

	/** Append a Warning. Legal only while `running`. */
	recordWarning(w: Warning): void {
		if (this._state !== "running")
			throw new IllegalTransitionError(this._state, "recordWarning");
		this._warnings.push(w);
	}

	/** Complete: `done_with_warnings` iff the warning list is non-empty, else `done`. */
	complete(now: Date): void {
		if (this._state !== "running")
			throw new IllegalTransitionError(this._state, "complete");
		this._state = this._warnings.length > 0 ? "done_with_warnings" : "done";
		this._terminalAt = now;
	}

	/** Fail with a recorded reason. Legal only while `running`. */
	fail(reason: string, now: Date): void {
		if (this._state !== "running")
			throw new IllegalTransitionError(this._state, "fail");
		this._state = "failed";
		this._failureReason = reason;
		this._terminalAt = now;
	}

	toSnapshot(): JobSnapshot {
		return {
			anchor: this.anchor,
			createdAt: this.createdAt,
			failureReason: this._failureReason,
			id: this.id,
			startedAt: this._startedAt,
			state: this._state,
			terminalAt: this._terminalAt,
			warnings: [...this._warnings],
		};
	}
}
