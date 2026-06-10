import { describe, expect, it } from "vitest";
import {
	type BrandSearchHitLike,
	type CanonicalBrandLike,
	deSelfCollisions,
} from "./de-self";

const hit = (over: Partial<BrandSearchHitLike>): BrandSearchHitLike => ({
	brandId: null,
	domain: null,
	name: "Aglow",
	relevance: null,
	...over,
});

describe("deSelfCollisions", () => {
	it("drops the hit whose brandId equals the canonical brand (strongest)", () => {
		const hits = [
			hit({ brandId: "target", domain: "getaglow.co" }),
			hit({ brandId: "other", domain: "aglow.org" }),
		];
		const brand: CanonicalBrandLike = {
			brandId: "target",
			primaryDomain: "getaglow.co",
		};
		const { collisions, inferredTarget } = deSelfCollisions(hits, brand, null);
		expect(collisions.map((c) => c.brandId)).toEqual(["other"]);
		expect(inferredTarget).toBe(false);
	});

	it("falls back to registrable-domain match when there is no brandId key", () => {
		const hits = [
			hit({ domain: "www.getaglow.co" }),
			hit({ domain: "homeaglow.com" }),
		];
		const brand: CanonicalBrandLike = {
			brandId: null,
			primaryDomain: "getaglow.co",
		};
		const { collisions } = deSelfCollisions(hits, brand, null);
		expect(collisions.map((c) => c.domain)).toEqual(["homeaglow.com"]);
	});

	it("uses the anchor domain when the brand has no primary domain", () => {
		const hits = [hit({ domain: "getaglow.co" }), hit({ domain: "aglow.org" })];
		const { collisions } = deSelfCollisions(
			hits,
			{ brandId: null, primaryDomain: null },
			"getaglow.co",
		);
		expect(collisions.map((c) => c.domain)).toEqual(["aglow.org"]);
	});

	it("infers the top relevance hit as the target for a name-only anchor with no key", () => {
		const hits = [
			hit({ domain: "aglow.org", name: "Aglow", relevance: 0.5 }),
			hit({ domain: "getaglow.co", name: "Aglow Inc", relevance: 0.9 }),
		];
		const { collisions, inferredTarget } = deSelfCollisions(
			hits,
			{ brandId: null, primaryDomain: null },
			null,
		);
		expect(inferredTarget).toBe(true);
		expect(collisions.map((c) => c.domain)).toEqual(["aglow.org"]); // top (0.9) dropped as target
	});

	it("keeps a hit that matches neither key", () => {
		const hits = [hit({ brandId: "x", domain: "aglow.org" })];
		const { collisions } = deSelfCollisions(
			hits,
			{ brandId: "target", primaryDomain: "getaglow.co" },
			null,
		);
		expect(collisions).toHaveLength(1);
	});
});
