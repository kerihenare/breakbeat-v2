import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateAll,
} from "../../testing/integration-db";
import { DrizzleJobRepository } from "./job.repository";
import { SummaryDrizzleRepository } from "./summary.repository";

const db = getTestDatabase();
const jobs = new DrizzleJobRepository(db);
const repo = new SummaryDrizzleRepository(db);
const NOW = new Date("2026-06-10T00:00:00.000Z");

async function insertJob(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	return job.id;
}

describe("SummaryDrizzleRepository (compose Postgres, ADR 0008)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("round-trips a Summary keyed by job_id", async () => {
		const jobId = await insertJob();
		await repo.save(jobId, { summary: "Aglow coverage is positive." });
		expect(await repo.findByJobId(jobId)).toEqual({
			summary: "Aglow coverage is positive.",
		});
	});

	it("findByJobId returns null for a Job with no Summary (the degraded/absent reading)", async () => {
		const jobId = await insertJob();
		expect(await repo.findByJobId(jobId)).toBeNull();
	});

	it("a second save for the same Job upserts — one row, updated summary (one-per-Job PK invariant)", async () => {
		const jobId = await insertJob();
		await repo.save(jobId, { summary: "first digest" });
		await repo.save(jobId, { summary: "second digest (re-run)" });
		expect(await repo.findByJobId(jobId)).toEqual({
			summary: "second digest (re-run)",
		});

		const rows = await db.execute<{ n: number }>(
			sql`select count(*)::int as n from summaries where job_id = ${jobId}`,
		);
		expect(rows[0].n).toBe(1);
	});

	it("a re-run (new Job id) writes its own row, unaffected by another Job's Summary", async () => {
		const jobA = await insertJob();
		const jobB = await insertJob();
		await repo.save(jobA, { summary: "A digest" });
		await repo.save(jobB, { summary: "B digest" });
		expect(await repo.findByJobId(jobA)).toEqual({ summary: "A digest" });
		expect(await repo.findByJobId(jobB)).toEqual({ summary: "B digest" });
	});
});
