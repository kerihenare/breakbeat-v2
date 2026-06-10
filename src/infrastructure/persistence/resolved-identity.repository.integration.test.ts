import { uuidv7 } from "uuidv7";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import {
	closeTestDatabase,
	getTestDatabase,
	truncateAll,
} from "../../testing/integration-db";
import { DrizzleJobRepository } from "./job.repository";
import { ResolvedIdentityDrizzleRepository } from "./resolved-identity.repository";

const db = getTestDatabase();
const jobs = new DrizzleJobRepository(db);
const repo = new ResolvedIdentityDrizzleRepository(db);
const NOW = new Date("2026-06-10T00:00:00.000Z");

/** A Job row must exist first (FK). Insert a fresh Job and return its id. */
async function insertJob(): Promise<string> {
	const job = Job.create(uuidv7(), nameOnlyAnchor("Aglow"), NOW);
	await jobs.save(job);
	return job.id;
}

const sample = () =>
	ResolvedIdentity.assemble({
		brandContext: {
			description: "d",
			mission: null,
			productsAndServices: ["membership"],
			tagline: "t",
			tags: ["beauty"],
			targetAudienceSegments: ["consumers"],
			valueProposition: "vp",
		},
		companyName: "Aglow",
		nameCollisions: [
			{
				brandId: "b1",
				context: {
					description: "cleaning",
					mission: null,
					productsAndServices: ["cleaning"],
					tagline: null,
					tags: [],
					targetAudienceSegments: [],
					valueProposition: "cleaning marketplace",
				},
				domain: "homeaglow.com",
				name: "HomeAglow",
			},
			{
				brandId: null,
				context: null,
				domain: "aglowair.example",
				name: "Aglow Air",
			},
		],
		negativeBoost: "Known look-alikes ...",
		ownDomains: [
			{ domain: "getaglow.co", provenance: "url_provided" },
			{ domain: "aglow.app", provenance: "brand_derived" },
		],
		socialHandles: [
			{ handle: "getaglow", platform: "x", url: "https://x.com/getaglow" },
		],
	});

describe("ResolvedIdentityDrizzleRepository (integration)", () => {
	beforeEach(async () => {
		await truncateAll();
	});
	afterAll(async () => {
		await closeTestDatabase();
	});

	it("round-trips the full nested identity", async () => {
		const jobId = await insertJob();
		const original = sample();
		await repo.save(jobId, original);

		const loaded = await repo.findByJobId(jobId);
		expect(loaded).not.toBeNull();
		expect(loaded?.companyName).toBe("Aglow");
		expect(loaded?.ownDomains).toEqual(original.ownDomains);
		expect(loaded?.socialHandles).toEqual(original.socialHandles);
		expect(loaded?.brandContext).toEqual(original.brandContext);
		expect(loaded?.nameCollisions).toEqual(original.nameCollisions);
		expect(loaded?.negativeBoost).toBe("Known look-alikes ...");
	});

	it("returns null for a job with no identity", async () => {
		const jobId = await insertJob();
		expect(await repo.findByJobId(jobId)).toBeNull();
	});

	it("a re-run (new job id) writes its own rows; the prior identity is unchanged", async () => {
		const jobA = await insertJob();
		const jobB = await insertJob();
		await repo.save(jobA, sample());
		await repo.save(
			jobB,
			ResolvedIdentity.assemble({
				brandContext: null,
				companyName: "Aglow Rerun",
				nameCollisions: [],
				negativeBoost: "",
				ownDomains: [],
				socialHandles: [],
			}),
		);
		expect((await repo.findByJobId(jobA))?.companyName).toBe("Aglow");
		expect((await repo.findByJobId(jobB))?.companyName).toBe("Aglow Rerun");
	});
});
