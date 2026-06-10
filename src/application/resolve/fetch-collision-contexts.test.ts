import { describe, expect, it, vi } from "vitest";
import type { BrandContext } from "../../domain/resolve/brand-context";
import { fetchCollisionContexts } from "./fetch-collision-contexts";
import type { BrandContextPort } from "./ports/brand-context.port";
import type { BrandSearchHit } from "./ports/brand-search.port";

const ctxData = (): BrandContext => ({
	description: "d",
	mission: null,
	productsAndServices: [],
	tagline: null,
	tags: [],
	targetAudienceSegments: [],
	valueProposition: "vp",
});

const hit = (over: Partial<BrandSearchHit>): BrandSearchHit => ({
	brandId: null,
	domain: null,
	name: "Aglow",
	relevance: null,
	...over,
});

describe("fetchCollisionContexts", () => {
	it("fetches one context per candidate domain and counts failures", async () => {
		const port: BrandContextPort = {
			fetchContext: vi.fn(async (d: string) =>
				d === "aglowair.example" ? null : ctxData(),
			),
		};
		const { collisions, failures } = await fetchCollisionContexts(
			[
				hit({ brandId: "c1", domain: "homeaglow.com", name: "HomeAglow" }),
				hit({ brandId: "c2", domain: "aglowair.example", name: "Aglow Air" }),
			],
			port,
		);
		expect(failures).toBe(1);
		expect(
			collisions.find((c) => c.domain === "homeaglow.com")?.context,
		).not.toBeNull();
		expect(
			collisions.find((c) => c.domain === "aglowair.example")?.context,
		).toBeNull();
	});

	it("does not fetch (or count a failure) for a candidate with no domain", async () => {
		const port: BrandContextPort = {
			fetchContext: vi.fn(async () => ctxData()),
		};
		const { collisions, failures } = await fetchCollisionContexts(
			[hit({ brandId: "c1", domain: null, name: "No Domain" })],
			port,
		);
		expect(port.fetchContext).not.toHaveBeenCalled();
		expect(failures).toBe(0);
		expect(collisions[0]).toEqual({
			brandId: "c1",
			context: null,
			domain: "",
			name: "No Domain",
		});
	});
});
