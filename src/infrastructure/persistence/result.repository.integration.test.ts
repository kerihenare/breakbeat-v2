import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ResultInsert } from "../../application/search/ports/result-repository.port";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateAll,
} from "../../testing/integration-db";
import { DrizzleJobRepository } from "./job.repository";
import { ResultDrizzleRepository } from "./result.repository";

const db = getTestDatabase();
const jobs = new DrizzleJobRepository(db);
const repo = new ResultDrizzleRepository(db);
const NOW = new Date("2026-06-10T00:00:00.000Z");

/** A Job row must exist first (FK). Insert a fresh Job and return its id. */
async function insertJob(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	return job.id;
}

const insert = (over: Partial<ResultInsert> = {}): ResultInsert => ({
	matchScore: 80,
	normalizedUrl: "example.com/story",
	publishedDate: "2026-01-02",
	snippet: "Aglow raised...",
	source: "tavily",
	title: "Aglow funding",
	url: "https://www.example.com/story",
	...over,
});

describe("ResultDrizzleRepository (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("inserts born-`included` Results carrying the provisional Match Score, no verification_status", async () => {
		const jobId = await insertJob();
		const n = await repo.insertIncluded(jobId, [insert()]);
		expect(n).toBe(1);

		const rows = await db.execute<{
			status: string;
			match_score: number;
			verification_status: string | null;
		}>(
			sql`select status, match_score, verification_status from results where job_id = ${jobId}`,
		);
		const row = rows[0];
		expect(row.status).toBe("included");
		expect(Number(row.match_score)).toBe(80);
		expect(row.verification_status).toBeNull();
	});

	it("absorbs a duplicate (job_id, normalized_url) — inserted once, reported as 0 the second time", async () => {
		const jobId = await insertJob();
		expect(await repo.insertIncluded(jobId, [insert()])).toBe(1);
		expect(
			await repo.insertIncluded(jobId, [
				insert({ title: "different title, same url" }),
			]),
		).toBe(0);
	});

	it("dedups across sources within one batch (same url from tavily and backstop) → one row", async () => {
		const jobId = await insertJob();
		const n = await repo.insertIncluded(jobId, [
			insert(),
			insert({ matchScore: 0, source: "web_search_backstop" }),
		]);
		expect(n).toBe(1);
	});

	it("orders by Match Score descending: Tavily rows above the backstop floor", async () => {
		const jobId = await insertJob();
		await repo.insertIncluded(jobId, [
			insert({
				matchScore: 0,
				normalizedUrl: "a/1",
				source: "web_search_backstop",
				url: "https://a/1",
			}),
			insert({ matchScore: 90, normalizedUrl: "b/1", url: "https://b/1" }),
		]);
		const ordered = await repo.findOrderedByScore(jobId);
		expect(ordered.map((r) => r.matchScore)).toEqual([90, 0]);
	});

	it("a re-run (new job id) writes its own rows; the prior Job's Results are unchanged", async () => {
		const jobA = await insertJob();
		const jobB = await insertJob();
		await repo.insertIncluded(jobA, [
			insert({ normalizedUrl: "a/x", url: "https://a/x" }),
		]);
		await repo.insertIncluded(jobB, [
			insert({ normalizedUrl: "b/y", url: "https://b/y" }),
		]);
		expect(
			await repo.insertIncluded(jobA, [
				insert({ normalizedUrl: "a/x", url: "https://a/x" }),
			]),
		).toBe(0);
		expect((await repo.findOrderedByScore(jobB)).length).toBe(1);
	});
});
