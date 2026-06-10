import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandSearchAdapter } from "./brand-search.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

const config = {
	apiKey: "k",
	baseUrl: "https://api.brandfetch.io/v2",
	timeoutMs: 50,
};
const adapter = () => new BrandSearchAdapter(new BrandfetchHttp(config));
afterEach(() => vi.unstubAllGlobals());

describe("BrandSearchAdapter", () => {
	it("requests /search/{query} and maps hits into the port shape", async () => {
		const body = [
			{ brandId: "b1", domain: "getaglow.co", name: "Aglow", score: 0.9 },
			{ brandId: "b2", domain: "homeaglow.com", name: "HomeAglow", score: 0.4 },
		];
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify(body), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const hits = await adapter().search("Aglow");
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.brandfetch.io/v2/search/Aglow",
		);
		expect(hits).toEqual([
			{ brandId: "b1", domain: "getaglow.co", name: "Aglow", relevance: 0.9 },
			{
				brandId: "b2",
				domain: "homeaglow.com",
				name: "HomeAglow",
				relevance: 0.4,
			},
		]);
	});

	it("URL-encodes the query", async () => {
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response("[]", { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		await adapter().search("Aglow & Co");
		expect(fetchMock.mock.calls[0][0]).toContain("/search/Aglow%20%26%20Co");
	});

	it("returns [] on transport failure (null body)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("x", { status: 500 })),
		);
		expect(await adapter().search("Aglow")).toEqual([]);
	});

	it("returns [] when the payload fails to parse", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ not: "an array" }), { status: 200 }),
			),
		);
		expect(await adapter().search("Aglow")).toEqual([]);
	});
});
