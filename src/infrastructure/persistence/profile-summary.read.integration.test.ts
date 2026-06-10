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
import {
	DrizzleResolvedIdentityReadModel,
	DrizzleSummaryReadModel,
} from "./read-models";
import {
	resolvedIdentities,
	resolvedIdentityCollisions,
	resolvedIdentityHandles,
	resolvedIdentityOwnDomains,
	summaries,
} from "./schema";

const db = getTestDatabase();
const identities = new DrizzleResolvedIdentityReadModel(db);
const summaryReads = new DrizzleSummaryReadModel(db);
const jobs = new DrizzleJobRepository(db);
const NOW = new Date("2026-06-10T00:00:00.000Z");

async function seed(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	await db.insert(resolvedIdentities).values({
		brandContext: {
			description: "Skincare brand.",
			mission: null,
			productsAndServices: [],
			tagline: "Glow on.",
			tags: ["skincare", "beauty"],
			targetAudienceSegments: [],
			valueProposition: null,
		},
		companyName: "Aglow",
		jobId: job.id,
		negativeBoost: "",
	});
	await db
		.insert(resolvedIdentityOwnDomains)
		.values([
			{ domain: "aglow.com", jobId: job.id, provenance: "url_provided" },
		]);
	await db.insert(resolvedIdentityHandles).values([
		{
			handle: "@aglow",
			jobId: job.id,
			platform: "instagram",
			url: "https://instagram.com/aglow",
		},
	]);
	await db.insert(resolvedIdentityCollisions).values([
		{ domain: "aglowit.com", jobId: job.id, name: "Aglow IT" },
		{ domain: "aglowderm.com", jobId: job.id, name: "Aglow Dermatology" },
	]);
	await db.insert(summaries).values({
		jobId: job.id,
		summary: "Aglow had strong coverage this period.",
	});
	return job.id;
}

describe("Resolved-identity + summary read models (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("reads the profile card: brand context + domains + handles + collision count", async () => {
		const jobId = await seed();
		const profile = await identities.find(jobId);
		expect(profile).toMatchObject({
			collisionCount: 2,
			companyName: "Aglow",
			description: "Skincare brand.",
			tagline: "Glow on.",
			tags: ["skincare", "beauty"],
		});
		expect(profile?.ownDomains).toEqual([
			{ domain: "aglow.com", provenance: "url_provided" },
		]);
		expect(profile?.handles).toEqual([
			{
				handle: "@aglow",
				platform: "instagram",
				url: "https://instagram.com/aglow",
			},
		]);
	});

	it("returns null for a Job with no Resolved Identity", async () => {
		const job = Job.create(uuidv7(), nameOnlyAnchor("Nobody"), NOW);
		await jobs.save(job);
		expect(await identities.find(job.id)).toBeNull();
	});

	it("reads the Job-level summary digest, or null when absent", async () => {
		const jobId = await seed();
		expect(await summaryReads.find(jobId)).toEqual({
			digest: "Aglow had strong coverage this period.",
		});
		const other = Job.create(uuidv7(), nameOnlyAnchor("NoSummary"), NOW);
		await jobs.save(other);
		expect(await summaryReads.find(other.id)).toBeNull();
	});
});
