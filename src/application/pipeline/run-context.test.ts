import { describe, expect, it } from "vitest";
import { disambiguatedAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { RunContext } from "./run-context";

function runningContext(): RunContext {
	const job = Job.create(
		"job-1",
		disambiguatedAnchor({ domain: "aglow.example", provenance: "picked" }),
		new Date(),
	);
	job.start(new Date());
	return new RunContext(job);
}

const identity = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [],
		socialHandles: [],
	});

describe("RunContext resolvedIdentity slot", () => {
	it("starts undefined and is readable after setResolvedIdentity", () => {
		const ctx = runningContext();
		expect(ctx.resolvedIdentity).toBeUndefined();
		const id = identity();
		ctx.setResolvedIdentity(id);
		expect(ctx.resolvedIdentity).toBe(id);
	});

	it("throws if set twice in one run (single consistent anchor)", () => {
		const ctx = runningContext();
		ctx.setResolvedIdentity(identity());
		expect(() => ctx.setResolvedIdentity(identity())).toThrow(/set once/i);
	});
});
