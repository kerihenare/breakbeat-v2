import { describe, expect, it } from "vitest";
import {
	FakeJobQueue,
	FakeJobRepository,
	FixedClock,
	SequenceIdGenerator,
} from "../testing/fakes";
import { SubmitJobUseCase } from "./submit-job.usecase";

function makeUseCase() {
	const jobs = new FakeJobRepository();
	const queue = new FakeJobQueue();
	const useCase = new SubmitJobUseCase(
		jobs,
		queue,
		new FixedClock(),
		new SequenceIdGenerator(),
	);
	return { jobs, queue, useCase };
}

describe("SubmitJobUseCase", () => {
	it("rejects blank/garbage input", async () => {
		const { useCase } = makeUseCase();
		await expect(useCase.execute({})).rejects.toThrow();
		await expect(useCase.execute({ query: "   " })).rejects.toThrow();
	});

	it("accepts a bare name and freezes a name_only anchor", async () => {
		const { jobs, queue, useCase } = makeUseCase();
		const id = await useCase.execute({ query: "Aglow" });
		const job = await jobs.findById(id);
		expect(job?.state).toBe("pending");
		expect(job?.anchor).toEqual({
			kind: "name_only",
			name: "Aglow",
			provenance: "name_only",
		});
		expect(jobs.count).toBe(1);
		expect(queue.enqueued).toEqual([{ jobId: id }]);
	});

	it("treats a pasted URL as a disambiguated url_provided anchor", async () => {
		const { jobs, useCase } = makeUseCase();
		const id = await useCase.execute({ query: "https://www.aglow.com/about" });
		const job = await jobs.findById(id);
		expect(job?.anchor).toEqual({
			brandId: null,
			domain: "aglow.com",
			kind: "disambiguated",
			provenance: "url_provided",
		});
	});

	it("treats a bare domain as a disambiguated url_provided anchor", async () => {
		const { jobs, useCase } = makeUseCase();
		const id = await useCase.execute({ query: "aglow.com" });
		const job = await jobs.findById(id);
		expect(job?.anchor).toMatchObject({
			domain: "aglow.com",
			kind: "disambiguated",
			provenance: "url_provided",
		});
	});

	it("treats a picked brand selection as a disambiguated picked anchor", async () => {
		const { jobs, useCase } = makeUseCase();
		const id = await useCase.execute({
			brandId: "brand_42",
			domain: "aglow.com",
		});
		const job = await jobs.findById(id);
		expect(job?.anchor).toEqual({
			brandId: "brand_42",
			domain: "aglow.com",
			kind: "disambiguated",
			provenance: "picked",
		});
	});

	it("persists the pending Job before enqueuing exactly one unit", async () => {
		const { jobs, queue, useCase } = makeUseCase();
		const id = await useCase.execute({ query: "Aglow" });
		expect(jobs.savedStates).toEqual(["pending"]);
		expect(queue.enqueued).toHaveLength(1);
		expect(queue.enqueued[0]?.jobId).toBe(id);
	});
});
