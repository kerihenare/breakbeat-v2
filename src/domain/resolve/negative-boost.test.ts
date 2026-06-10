import { describe, expect, it } from "vitest";
import type { CollisionContext } from "./brand-context";
import type { NameCollision } from "./name-collision";
import { deriveNegativeBoost } from "./negative-boost";

const ctx = (over: Partial<CollisionContext> = {}): CollisionContext => ({
	description: "desc",
	mission: null,
	productsAndServices: ["svc"],
	tagline: null,
	tags: [],
	targetAudienceSegments: ["aud"],
	valueProposition: "VP",
	...over,
});

describe("deriveNegativeBoost", () => {
	it("returns empty string when there are no collisions", () => {
		expect(deriveNegativeBoost([])).toBe("");
	});

	it("emits the assertive header and one line per look-alike", () => {
		const collisions: NameCollision[] = [
			{
				brandId: "b1",
				context: ctx({ valueProposition: "A global Christian ministry" }),
				domain: "aglow.org",
				name: "Aglow International",
			},
			{
				brandId: "b2",
				context: ctx({ valueProposition: "Home-cleaning marketplace" }),
				domain: "homeaglow.com",
				name: "HomeAglow",
			},
		];
		const boost = deriveNegativeBoost(collisions);
		expect(boost).toMatch(/NOT the target — reject pages about these:/);
		expect(boost).toContain("Aglow International (aglow.org)");
		expect(boost).toContain("A global Christian ministry");
		expect(boost).toContain("HomeAglow (homeaglow.com)");
		expect(boost.trim().split("\n").length).toBe(3); // header + 2 lines
	});

	it("emits a name+domain-only line when a collision has no context", () => {
		const collisions: NameCollision[] = [
			{
				brandId: null,
				context: null,
				domain: "aglowair.example",
				name: "Aglow Air",
			},
		];
		const boost = deriveNegativeBoost(collisions);
		expect(boost).toContain("Aglow Air (aglowair.example)");
	});

	it("is synchronous and takes no injected dependency (structural zero-LLM proof)", () => {
		// deriveNegativeBoost has arity 1 (collisions only) and returns a string, not a Promise.
		expect(deriveNegativeBoost.length).toBe(1);
		const out = deriveNegativeBoost([]);
		expect(out).not.toBeInstanceOf(Promise);
	});
});
