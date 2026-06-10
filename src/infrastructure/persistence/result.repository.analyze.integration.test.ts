import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type {
	FullTextOutcome,
	ResultInsert,
} from "../../application/search/ports/result-repository.port";
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
const PROVISIONAL = 42; // the provisional rung Search wrote

async function insertJob(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	return job.id;
}

const insert = (over: Partial<ResultInsert> = {}): ResultInsert => ({
	matchScore: PROVISIONAL,
	normalizedUrl: "news.example/a",
	publishedDate: "2026-01-02",
	snippet: "s",
	source: "tavily",
	title: "Aglow",
	url: "https://news.example/a",
	...over,
});

/** Insert one born-`included` Result and return its id. */
async function seed(jobId: string): Promise<string> {
	await repo.insertIncluded(jobId, [insert()]);
	return (await repo.findIncluded(jobId))[0].id;
}

type ResultRow = {
	content_type: string | null;
	exclusion_code: string | null;
	exclusion_detail: string | null;
	extracted_content: string | null;
	match_score: number | null;
	sentiment: string | null;
	status: string;
	takeaway: string | null;
	verification_status: string | null;
};

async function readResult(id: string): Promise<ResultRow> {
	const rows = await db.execute<ResultRow>(
		sql`select content_type, exclusion_code, exclusion_detail, extracted_content, match_score, sentiment, status, takeaway, verification_status from results where id = ${id}`,
	);
	return rows[0];
}

describe("ResultDrizzleRepository — analyze writes (compose Postgres, ADR 0008)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("setInterimMatchScore overwrites the provisional match_score and touches no other column", async () => {
		const id = await seed(await insertJob());
		await repo.setInterimMatchScore(id, 62);

		const row = await readResult(id);
		expect(Number(row.match_score)).toBe(62);
		expect(row.verification_status).toBeNull(); // NOT written by this method
		expect(row.content_type).toBeNull();
		expect(row.status).toBe("included");
	});

	it("setProvisionalContentType sets content_type only", async () => {
		const id = await seed(await insertJob());
		await repo.setProvisionalContentType(id, "blog_post");

		const row = await readResult(id);
		expect(row.content_type).toBe("blog_post");
		expect(Number(row.match_score)).toBe(PROVISIONAL); // untouched
		expect(row.verification_status).toBeNull();
	});

	it("applyFullTextOutcome sets match_score (final) + verification_status + content_type + sentiment + takeaway together, never status", async () => {
		const id = await seed(await insertJob());
		const outcome: FullTextOutcome = {
			contentType: "news_article",
			matchScore: 88,
			sentiment: "positive",
			takeaway: "Aglow raised a round.",
			verificationStatus: "verified",
		};
		await repo.applyFullTextOutcome(id, outcome);

		const row = await readResult(id);
		expect(Number(row.match_score)).toBe(88); // final rung overwrites interim/provisional
		expect(row.verification_status).toBe("verified");
		expect(row.content_type).toBe("news_article");
		expect(row.sentiment).toBe("positive");
		expect(row.takeaway).toBe("Aglow raised a round.");
		expect(row.status).toBe("included"); // never touched
	});

	it("setExtractedContent persists the Extracted full text (display-only, PRD 07) and touches no other column", async () => {
		const id = await seed(await insertJob());
		await repo.setExtractedContent(id, "the full extracted page text");

		const row = await readResult(id);
		expect(row.extracted_content).toBe("the full extracted page text");
		expect(Number(row.match_score)).toBe(PROVISIONAL); // untouched
		expect(row.verification_status).toBeNull();
		expect(row.status).toBe("included");
	});

	it("a Result with no Extract leaves extracted_content NULL (a successful write is the only thing that sets it)", async () => {
		const id = await seed(await insertJob());
		await repo.setInterimMatchScore(id, 55); // a non-Extract write does NOT touch extracted_content

		const row = await readResult(id);
		expect(row.extracted_content).toBeNull(); // Extract did not succeed → NULL
	});

	it("a failed Extract leaves a Result included with its interim score and NULL verification_status (no full-text write)", async () => {
		const id = await seed(await insertJob());
		await repo.setInterimMatchScore(id, 55); // interim rung only — Extract failed, no full-text write

		const row = await readResult(id);
		expect(Number(row.match_score)).toBe(55); // ordering preserved
		expect(row.verification_status).toBeNull(); // read "Unverified" — NULL status does NOT imply NULL score
		expect(row.status).toBe("included");
	});

	it("recordExclusion(id, 'off_topic', 'LLM') flips included → excluded and is idempotent (WHERE status = 'included' guard)", async () => {
		const id = await seed(await insertJob());
		await repo.recordExclusion(id, "off_topic", "LLM");
		await repo.recordExclusion(id, "off_topic", "LLM"); // no-op second time

		const row = await readResult(id);
		expect(row.status).toBe("excluded");
		expect(row.exclusion_code).toBe("off_topic");
		expect(row.exclusion_detail).toBe("LLM");
	});
});
