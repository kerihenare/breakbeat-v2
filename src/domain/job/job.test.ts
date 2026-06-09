import { describe, expect, it } from "vitest";
import { disambiguatedAnchor, nameOnlyAnchor } from "./company-anchor";
import { Job } from "./job";
import { IllegalTransitionError } from "./job-errors";
import { warning } from "./warning";

const T0 = new Date("2026-06-10T00:00:00.000Z");
const T1 = new Date("2026-06-10T00:01:00.000Z");
const T2 = new Date("2026-06-10T00:02:00.000Z");

const anchor = () =>
	disambiguatedAnchor({ domain: "aglow.example", provenance: "picked" });

function runningJob(): Job {
	const job = Job.create("job-1", anchor(), T0);
	job.start(T1);
	return job;
}

describe("Job.create", () => {
	it("is pending with the exact anchor, no warnings, createdAt set, other timestamps null", () => {
		const a = anchor();
		const job = Job.create("job-1", a, T0);
		expect(job.id).toBe("job-1");
		expect(job.state).toBe("pending");
		expect(job.anchor).toBe(a);
		expect(job.warnings).toEqual([]);
		expect(job.createdAt).toBe(T0);
		expect(job.startedAt).toBeNull();
		expect(job.terminalAt).toBeNull();
		expect(job.failureReason).toBeNull();
	});

	it("represents a name-only anchor with correct provenance", () => {
		const job = Job.create("job-2", nameOnlyAnchor("Aglow"), T0);
		expect(job.anchor).toEqual({
			kind: "name_only",
			name: "Aglow",
			provenance: "name_only",
		});
	});
});

describe("Job.start", () => {
	it("moves pending → running and sets startedAt", () => {
		const job = Job.create("job-1", anchor(), T0);
		job.start(T1);
		expect(job.state).toBe("running");
		expect(job.startedAt).toBe(T1);
	});

	it("is rejected from running", () => {
		const job = runningJob();
		expect(() => job.start(T2)).toThrow(IllegalTransitionError);
	});

	it("is rejected from every terminal state", () => {
		for (const drive of [
			(j: Job) => j.complete(T2),
			(j: Job) => j.fail("boom", T2),
		]) {
			const job = runningJob();
			drive(job);
			expect(() => job.start(T2)).toThrow(IllegalTransitionError);
		}
	});
});

describe("Job.complete derives the terminal state from the warning list", () => {
	it("with no warnings → done", () => {
		const job = runningJob();
		job.complete(T2);
		expect(job.state).toBe("done");
		expect(job.terminalAt).toBe(T2);
	});

	it("with one or more warnings → done_with_warnings (not a caller choice)", () => {
		const job = runningJob();
		job.recordWarning(warning("classify_failed", "Classify did not run"));
		job.complete(T2);
		expect(job.state).toBe("done_with_warnings");
		expect(job.warnings).toHaveLength(1);
	});

	it("is rejected from pending", () => {
		const job = Job.create("job-1", anchor(), T0);
		expect(() => job.complete(T2)).toThrow(IllegalTransitionError);
	});
});

describe("Job.fail", () => {
	it("moves running → failed with the reason and terminalAt", () => {
		const job = runningJob();
		job.fail("all search queries failed", T2);
		expect(job.state).toBe("failed");
		expect(job.failureReason).toBe("all search queries failed");
		expect(job.terminalAt).toBe(T2);
	});

	it("is rejected from pending", () => {
		const job = Job.create("job-1", anchor(), T0);
		expect(() => job.fail("boom", T2)).toThrow(IllegalTransitionError);
	});
});

describe("terminal states are absorbing", () => {
	const terminate: Array<[string, (j: Job) => void]> = [
		["done", (j) => j.complete(T2)],
		[
			"done_with_warnings",
			(j) => {
				j.recordWarning(warning("w", "m"));
				j.complete(T2);
			},
		],
		["failed", (j) => j.fail("boom", T2)],
	];

	for (const [name, drive] of terminate) {
		it(`${name} rejects start / recordWarning / complete / fail`, () => {
			const job = runningJob();
			drive(job);
			expect(() => job.start(T2)).toThrow(IllegalTransitionError);
			expect(() => job.recordWarning(warning("w", "m"))).toThrow(
				IllegalTransitionError,
			);
			expect(() => job.complete(T2)).toThrow(IllegalTransitionError);
			expect(() => job.fail("again", T2)).toThrow(IllegalTransitionError);
		});
	}
});

describe("recordWarning is legal only while running", () => {
	it("is rejected from pending", () => {
		const job = Job.create("job-1", anchor(), T0);
		expect(() => job.recordWarning(warning("w", "m"))).toThrow(
			IllegalTransitionError,
		);
	});

	it("accumulates warnings in order while running", () => {
		const job = runningJob();
		job.recordWarning(warning("a", "first"));
		job.recordWarning(warning("b", "second"));
		expect(job.warnings.map((w) => w.type)).toEqual(["a", "b"]);
	});
});

describe("warning list is encapsulated", () => {
	it("the getter returns a copy that cannot mutate internal state", () => {
		const job = runningJob();
		job.recordWarning(warning("a", "first"));
		const snapshot = job.warnings as Warning[];
		snapshot.push(warning("b", "injected"));
		expect(job.warnings).toHaveLength(1);
	});
});

describe("Job.fromPersistence rebuilds without re-running transitions", () => {
	it("loads a done_with_warnings Job directly (no throw)", () => {
		const job = Job.fromPersistence({
			anchor: anchor(),
			createdAt: T0,
			failureReason: null,
			id: "job-1",
			startedAt: T1,
			state: "done_with_warnings",
			terminalAt: T2,
			warnings: [warning("classify_failed", "Classify did not run")],
		});
		expect(job.state).toBe("done_with_warnings");
		expect(job.warnings).toHaveLength(1);
		expect(job.terminalAt).toBe(T2);
	});

	it("round-trips a snapshot", () => {
		const job = runningJob();
		job.recordWarning(warning("a", "m"));
		job.complete(T2);
		const rebuilt = Job.fromPersistence(job.toSnapshot());
		expect(rebuilt.toSnapshot()).toEqual(job.toSnapshot());
	});
});

// Local alias so the encapsulation test can attempt a forbidden mutation.
type Warning = ReturnType<typeof warning>;
