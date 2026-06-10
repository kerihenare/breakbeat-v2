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

async function insertJob(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	return job.id;
}

const insert = (over: Partial<ResultInsert> = {}): ResultInsert => ({
	matchScore: 80,
	normalizedUrl: "news.example/aglow-seed",
	publishedDate: "2026-01-02",
	snippet: "Aglow raised a seed round.",
	source: "tavily",
	title: "Aglow raises seed",
	url: "https://news.example/aglow-seed",
	...over,
});

describe("ResultDrizzleRepository.findIncludedForSummary (compose Postgres, ADR 0008)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("returns only `included` rows with snippet + takeaway + sentiment; excludes every `excluded` row", async () => {
		const jobId = await insertJob();
		await repo.insertIncluded(jobId, [
			insert({ normalizedUrl: "a/1", snippet: "kept one", url: "https://a/1" }),
			insert({ normalizedUrl: "a/2", snippet: "kept two", url: "https://a/2" }),
			insert({
				normalizedUrl: "a/3",
				snippet: "excluded one",
				url: "https://a/3",
			}),
		]);
		// Enhance writes takeaway + sentiment onto the surviving rows (Analyze's applyFullTextOutcome).
		const kept = await repo.findIncluded(jobId);
		const byUrl = new Map(kept.map((r) => [r.url, r.id]));
		await repo.applyFullTextOutcome(byUrl.get("https://a/1") as string, {
			contentType: "news_article",
			matchScore: 88,
			sentiment: "positive",
			takeaway: "Aglow is growing.",
			verificationStatus: "verified",
		});
		// a/2 survives with NO Enhancement (Enhance Warned) → takeaway/sentiment NULL.
		// Exclude a/3 (off_topic) so it must NOT appear in the summarise input.
		await repo.recordExclusion(
			byUrl.get("https://a/3") as string,
			"off_topic",
			"LLM",
		);

		const rows = await repo.findIncludedForSummary(jobId);
		expect(rows.map((r) => r.snippet).sort()).toEqual(["kept one", "kept two"]);
		const one = rows.find((r) => r.snippet === "kept one");
		expect(one).toEqual({
			sentiment: "positive",
			snippet: "kept one",
			takeaway: "Aglow is growing.",
		});
		const two = rows.find((r) => r.snippet === "kept two");
		expect(two).toEqual({
			sentiment: null,
			snippet: "kept two",
			takeaway: null,
		});
	});

	it("returns [] for a Job whose every Result was Excluded (the empty case at the SQL boundary)", async () => {
		const jobId = await insertJob();
		await repo.insertIncluded(jobId, [
			insert({ normalizedUrl: "b/1", url: "https://b/1" }),
		]);
		const kept = await repo.findIncluded(jobId);
		await repo.recordExclusion(kept[0].id, "off_topic", "LLM");
		expect(await repo.findIncludedForSummary(jobId)).toEqual([]);
	});
});
