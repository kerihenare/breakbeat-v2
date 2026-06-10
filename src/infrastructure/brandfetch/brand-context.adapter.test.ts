import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandContextAdapter } from "./brand-context.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

const config = {
	apiKey: "k",
	baseUrl: "https://api.brandfetch.io/v2",
	timeoutMs: 50,
};
const adapter = () => new BrandContextAdapter(new BrandfetchHttp(config));
afterEach(() => vi.unstubAllGlobals());

describe("BrandContextAdapter", () => {
	it("requests /context/{domain} and maps the positioning fields", async () => {
		const body = {
			description: "Sydney beauty-membership startup",
			mission: "Make beauty accessible",
			productsAndServices: ["membership", "bookings"],
			tagline: "Beauty membership",
			tags: ["beauty", "membership"],
			targetAudienceSegments: ["consumers", "members"],
			valueProposition: "Membership-based beauty services",
		};
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify(body), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const ctx = await adapter().fetchContext("getaglow.co");
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.brandfetch.io/v2/context/getaglow.co",
		);
		expect(ctx).toEqual(body);
	});

	it("defaults missing fields to null / empty arrays", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ description: "d" }), { status: 200 }),
			),
		);
		const ctx = await adapter().fetchContext("getaglow.co");
		expect(ctx).toEqual({
			description: "d",
			mission: null,
			productsAndServices: [],
			tagline: null,
			tags: [],
			targetAudienceSegments: [],
			valueProposition: null,
		});
	});

	it("returns null on transport failure (absent context = Warning upstream)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("x", { status: 404 })),
		);
		expect(await adapter().fetchContext("getaglow.co")).toBeNull();
	});
});
