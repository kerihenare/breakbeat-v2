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

describe("ResultDrizzleRepository — Filter methods (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("findIncluded returns only included rows with the content columns", async () => {
		const jobId = await insertJob();
		await repo.insertIncluded(jobId, [
			insert({ normalizedUrl: "a/1", title: "Keep me", url: "https://a/1" }),
			insert({ normalizedUrl: "b/2", title: "Exclude me", url: "https://b/2" }),
		]);
		const before = await repo.findIncluded(jobId);
		expect(before).toHaveLength(2);
		const excludeId = before.find((r) => r.title === "Exclude me")?.id;
		if (!excludeId) throw new Error("expected an 'Exclude me' row");
		await repo.recordExclusion(excludeId, "aggregator", null);

		const after = await repo.findIncluded(jobId);
		expect(after.map((r) => r.title)).toEqual(["Keep me"]);
		expect(after[0]).toMatchObject({
			publishedDate: "2026-01-02",
			snippet: "Aglow raised...",
			url: "https://a/1",
		});
	});

	it("recordExclusion flips included → excluded with code/detail and leaves match_score untouched", async () => {
		const jobId = await insertJob();
		await repo.insertIncluded(jobId, [
			insert({ matchScore: 73, normalizedUrl: "d/1", url: "https://d/1" }),
		]);
		const id = (await repo.findIncluded(jobId))[0].id;
		await repo.recordExclusion(id, "duplicate", "of:other-id");

		const rows = await db.execute<{
			status: string;
			exclusion_code: string;
			exclusion_detail: string | null;
			match_score: number;
		}>(
			sql`select status, exclusion_code, exclusion_detail, match_score from results where id = ${id}`,
		);
		const r = rows[0];
		expect(r.status).toBe("excluded");
		expect(r.exclusion_code).toBe("duplicate");
		expect(r.exclusion_detail).toBe("of:other-id");
		expect(Number(r.match_score)).toBe(73);
	});

	it("recordExclusion is idempotent: a second call never rewrites the code", async () => {
		const jobId = await insertJob();
		await repo.insertIncluded(jobId, [
			insert({ normalizedUrl: "e/1", url: "https://e/1" }),
		]);
		const id = (await repo.findIncluded(jobId))[0].id;
		await repo.recordExclusion(id, "own_channel", null);
		await repo.recordExclusion(id, "duplicate", "of:x"); // must be a no-op (status already 'excluded')

		const rows = await db.execute<{ exclusion_code: string }>(
			sql`select exclusion_code from results where id = ${id}`,
		);
		expect(rows[0].exclusion_code).toBe("own_channel");
	});

	it("does not touch another Job's rows", async () => {
		const jobA = await insertJob();
		const jobB = await insertJob();
		await repo.insertIncluded(jobA, [
			insert({ normalizedUrl: "a/x", url: "https://a/x" }),
		]);
		await repo.insertIncluded(jobB, [
			insert({ normalizedUrl: "b/y", url: "https://b/y" }),
		]);
		const idA = (await repo.findIncluded(jobA))[0].id;
		await repo.recordExclusion(idA, "aggregator", null);
		expect(await repo.findIncluded(jobB)).toHaveLength(1);
	});
});
