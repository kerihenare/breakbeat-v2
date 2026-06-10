import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandfetchHttp } from "./brandfetch.http";

const config = {
	apiKey: "key",
	baseUrl: "https://api.brandfetch.io/v2",
	timeoutMs: 50,
};

afterEach(() => vi.unstubAllGlobals());

describe("BrandfetchHttp.getJson", () => {
	it("sends a Bearer-authenticated GET to baseUrl + path and returns parsed JSON", async () => {
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const http = new BrandfetchHttp(config);
		const out = await http.getJson("/search/Aglow");
		expect(out).toEqual({ ok: true });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.brandfetch.io/v2/search/Aglow");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer key",
		});
	});

	it("returns null on non-2xx", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 404 })),
		);
		expect(await new BrandfetchHttp(config).getJson("/x")).toBeNull();
	});

	it("returns null on network error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("ECONNREFUSED");
			}),
		);
		expect(await new BrandfetchHttp(config).getJson("/x")).toBeNull();
	});

	it("returns null on timeout (AbortError)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				(_: string, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener("abort", () =>
							reject(new DOMException("aborted", "AbortError")),
						);
					}),
			),
		);
		expect(
			await new BrandfetchHttp({ ...config, timeoutMs: 10 }).getJson("/x"),
		).toBeNull();
	});
});
