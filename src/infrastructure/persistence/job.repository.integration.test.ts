import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
	disambiguatedAnchor,
	nameOnlyAnchor,
} from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { warning } from "../../domain/job/warning";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateAll,
} from "../../testing/integration-db";
import { DrizzleJobRepository } from "./job.repository";
import { results, warnings } from "./schema";

const db = getTestDatabase();
const repo = new DrizzleJobRepository(db);
const NOW = new Date("2026-06-10T00:00:00.000Z");

async function seedJob(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await repo.save(job);
	return job.id;
}

describe("DrizzleJobRepository (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("round-trips a disambiguated anchor with provenance and state", async () => {
		const job = Job.create(
			uuidv7(),
			disambiguatedAnchor({ domain: "aglow.com", provenance: "url_provided" }),
			NOW,
		);
		await repo.save(job);
		const loaded = await repo.findById(job.id);
		expect(loaded?.state).toBe("pending");
		expect(loaded?.anchor).toEqual({
			brandId: null,
			domain: "aglow.com",
			kind: "disambiguated",
			provenance: "url_provided",
		});
		expect(loaded?.createdAt.getTime()).toBe(NOW.getTime());
	});

	it("persists warnings and the derived terminal state across a transition", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
		await repo.save(job);
		job.start(NOW);
		job.recordWarning(warning("classify_failed", "classification did not run"));
		job.complete(NOW);
		await repo.save(job);

		const loaded = await repo.findById(job.id);
		expect(loaded?.state).toBe("done_with_warnings");
		expect(loaded?.warnings).toHaveLength(1);
		expect(loaded?.warnings[0]).toEqual({
			message: "classification did not run",
			type: "classify_failed",
		});
	});

	it("save is append-only idempotent for warnings (re-save does not duplicate)", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
		job.start(NOW);
		job.recordWarning(warning("a", "first"));
		await repo.save(job);
		await repo.save(job); // re-save same state
		const loaded = await repo.findById(job.id);
		expect(loaded?.warnings).toHaveLength(1);
	});

	it("keyed (job_id, seq) sync inserts a missing earlier warning instead of skipping it (re-delivery safety)", async () => {
		const id = uuidv7();
		await repo.save(Job.create(id, nameOnlyAnchor("Aglow"), NOW));
		// Simulate a partial/out-of-order prior persist: only the *second* warning
		// landed, at seq 1. A positional count(=1) slice would skip warning[0]
		// forever and re-insert warning[1]; the keyed sync must heal this.
		await db
			.insert(warnings)
			.values({ jobId: id, message: "second", seq: 1, type: "b" });
		const job = Job.fromPersistence({
			anchor: nameOnlyAnchor("Aglow"),
			createdAt: NOW,
			failureReason: null,
			id,
			startedAt: NOW,
			state: "running",
			terminalAt: null,
			warnings: [warning("a", "first"), warning("b", "second")],
		});
		await repo.save(job);
		const loaded = await repo.findById(id);
		expect(loaded?.warnings).toEqual([
			{ message: "first", type: "a" },
			{ message: "second", type: "b" },
		]);
	});

	it("delete removes the Job and cascades to its warnings", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
		job.start(NOW);
		job.recordWarning(warning("a", "first"));
		await repo.save(job);
		await repo.delete(job.id);
		expect(await repo.findById(job.id)).toBeNull();
		const remaining = await db
			.select()
			.from(warnings)
			.where(eq(warnings.jobId, job.id));
		expect(remaining).toHaveLength(0);
	});

	it("delete of an unknown id is a no-op", async () => {
		await expect(repo.delete(uuidv7())).resolves.toBeUndefined();
	});

	it("records a failed Job with its reason", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
		job.start(NOW);
		job.fail("all search queries failed", NOW);
		await repo.save(job);
		const loaded = await repo.findById(job.id);
		expect(loaded?.state).toBe("failed");
		expect(loaded?.failureReason).toBe("all search queries failed");
	});

	it("returns null for an unknown id", async () => {
		expect(await repo.findById(uuidv7())).toBeNull();
	});

	it("born-included: a results row inserted with no status defaults to included", async () => {
		const jobId = await seedJob();
		await db.insert(results).values({
			jobId,
			normalizedUrl: "x.example/a",
			url: "https://x.example/a",
		});
		const [row] = await db
			.select()
			.from(results)
			.where(eq(results.jobId, jobId));
		expect(row?.status).toBe("included");
		expect(row?.exclusionCode).toBeNull();
	});

	it("the exclusion-code check rejects an excluded row with no code", async () => {
		const jobId = await seedJob();
		await expect(
			db.insert(results).values({
				exclusionCode: null,
				jobId,
				normalizedUrl: "x.example/a",
				status: "excluded",
				url: "https://x.example/a",
			}),
		).rejects.toThrow();
	});

	it("the (job_id, normalized_url) unique index rejects a duplicate insert", async () => {
		const jobId = await seedJob();
		await db.insert(results).values({
			jobId,
			normalizedUrl: "x.example/a",
			url: "https://x.example/a",
		});
		await expect(
			db.insert(results).values({
				jobId,
				normalizedUrl: "x.example/a",
				url: "https://x.example/b",
			}),
		).rejects.toThrow();
	});

	it("a re-run is a new Job id with its own rows; the prior Job is unchanged", async () => {
		const anchor = disambiguatedAnchor({
			domain: "aglow.com",
			provenance: "picked",
		});
		const first = Job.create(uuidv7(), anchor, NOW);
		await repo.save(first);
		const second = Job.create(uuidv7(), anchor, NOW);
		await repo.save(second);
		expect(first.id).not.toBe(second.id);
		expect((await repo.findById(first.id))?.state).toBe("pending");
		expect((await repo.findById(second.id))?.state).toBe("pending");
	});
});
