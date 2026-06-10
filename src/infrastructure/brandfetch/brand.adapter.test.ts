import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandAdapter } from "./brand.adapter";
import { BrandfetchHttp } from "./brandfetch.http";

const config = {
	apiKey: "k",
	baseUrl: "https://api.brandfetch.io/v2",
	timeoutMs: 50,
};
const adapter = () => new BrandAdapter(new BrandfetchHttp(config));
afterEach(() => vi.unstubAllGlobals());

describe("BrandAdapter", () => {
	it("resolves by domain → canonical brand", async () => {
		const body = { domain: "getaglow.co", id: "b1", name: "Aglow" };
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify(body), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const brand = await adapter().resolveBrand({ domain: "getaglow.co" });
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.brandfetch.io/v2/brands/getaglow.co",
		);
		expect(brand).toEqual({
			brandId: "b1",
			name: "Aglow",
			primaryDomain: "getaglow.co",
		});
	});

	it("resolves by brandId when no domain given", async () => {
		const fetchMock = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify({ domain: "getaglow.co", id: "b1", name: "Aglow" }),
					{ status: 200 },
				),
		);
		vi.stubGlobal("fetch", fetchMock);
		await adapter().resolveBrand({ brandId: "b1" });
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.brandfetch.io/v2/brands/b1",
		);
	});

	it("returns null when neither domain nor brandId is given", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await adapter().resolveBrand({})).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns null on transport/parse failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("x", { status: 500 })),
		);
		expect(await adapter().resolveBrand({ domain: "getaglow.co" })).toBeNull();
	});
});
