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
import { DrizzleResultsReadModel } from "./read-models";
import { results } from "./schema";

const db = getTestDatabase();
const reads = new DrizzleResultsReadModel(db);
const jobs = new DrizzleJobRepository(db);
const NOW = new Date("2026-06-10T00:00:00.000Z");

const blogId = uuidv7();

async function seed(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	await db.insert(results).values([
		{
			contentType: "news_article",
			jobId: job.id,
			matchScore: 80,
			normalizedUrl: "news-a",
			status: "included",
			title: "News A",
			url: "https://news.example/a",
		},
		{
			contentType: "news_article",
			jobId: job.id,
			matchScore: 60,
			normalizedUrl: "news-b",
			status: "included",
			title: "News B",
			url: "https://news.example/b",
		},
		{
			contentType: "blog_post",
			extractedContent: "The full extracted article body.",
			id: blogId,
			jobId: job.id,
			matchScore: 90,
			normalizedUrl: "blog",
			snippet: "A short snippet.",
			status: "included",
			takeaway: "The single key takeaway.",
			title: "Blog",
			url: "https://blog.example/x",
		},
		{
			// NULL content type — the "unclassified" bucket.
			jobId: job.id,
			matchScore: 50,
			normalizedUrl: "unclassified",
			status: "included",
			title: "Unclassified one",
			url: "https://other.example/u",
		},
		{
			contentType: "news_article",
			exclusionCode: "off_topic",
			jobId: job.id,
			normalizedUrl: "excluded",
			status: "excluded",
			title: "Excluded one",
			url: "https://news.example/e",
		},
	]);
	return job.id;
}

describe("DrizzleResultsReadModel (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("includedPage returns every included row by Match Score desc, NULLs last", async () => {
		const jobId = await seed();
		const page = await reads.includedPage(jobId, 1, 20);
		expect(page.total).toBe(4);
		expect(page.items.map((r) => r.title)).toEqual([
			"Blog",
			"News A",
			"News B",
			"Unclassified one",
		]);
	});

	it("includedPage filters to a single content type, preserving order + total", async () => {
		const jobId = await seed();
		const page = await reads.includedPage(jobId, 1, 20, "news_article");
		expect(page.total).toBe(2);
		expect(page.items.map((r) => r.title)).toEqual(["News A", "News B"]);
	});

	it("includedPage 'unclassified' filters to the NULL content-type bucket", async () => {
		const jobId = await seed();
		const page = await reads.includedPage(jobId, 1, 20, "unclassified");
		expect(page.total).toBe(1);
		expect(page.items[0]?.title).toBe("Unclassified one");
	});

	it("countsByContentType surfaces the NULL bucket as 'unclassified' and ignores excluded", async () => {
		const jobId = await seed();
		const counts = await reads.countsByContentType(jobId);
		const byType = new Map(counts.map((c) => [c.contentType, c.count]));
		expect(byType.get("news_article")).toBe(2); // excluded news row not counted
		expect(byType.get("blog_post")).toBe(1);
		expect(byType.get("unclassified")).toBe(1);
	});

	it("detail returns the Result with its extracted content + takeaway, or null", async () => {
		const jobId = await seed();
		const detail = await reads.detail(jobId, blogId);
		expect(detail).toMatchObject({
			extractedContent: "The full extracted article body.",
			snippet: "A short snippet.",
			takeaway: "The single key takeaway.",
			title: "Blog",
		});
		expect(await reads.detail(jobId, uuidv7())).toBeNull();
	});
});
