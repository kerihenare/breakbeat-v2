import { afterEach, describe, expect, it, vi } from "vitest";
import { HomepageFetchAdapter } from "./homepage-fetch.adapter";

const adapter = () => new HomepageFetchAdapter({ timeoutMs: 50 });
afterEach(() => vi.unstubAllGlobals());

describe("HomepageFetchAdapter", () => {
	it("fetches https://{domain}, reads the name and scrapes handles", async () => {
		const html = `<html><head><title>Aglow — beauty</title></head><body>
      <a href="https://x.com/getaglow">X</a></body></html>`;
		const fetchMock = vi.fn<typeof fetch>(
			async () => new Response(html, { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const out = await adapter().fetch("getaglow.co");
		expect(fetchMock.mock.calls[0][0]).toBe("https://getaglow.co");
		expect(out?.confirmedName).toBe("Aglow — beauty");
		expect(out?.handles.map((h) => h.platform)).toContain("x");
	});

	it("prefers og:site_name over <title> when present", async () => {
		const html = `<head><meta property="og:site_name" content="Aglow"><title>Home | Aglow</title></head>`;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(html, { status: 200 })),
		);
		expect((await adapter().fetch("getaglow.co"))?.confirmedName).toBe("Aglow");
	});

	it("returns null on non-2xx (homepage fetch failed → Warning upstream)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("x", { status: 503 })),
		);
		expect(await adapter().fetch("getaglow.co")).toBeNull();
	});

	it("returns null on network error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("ENOTFOUND");
			}),
		);
		expect(await adapter().fetch("getaglow.co")).toBeNull();
	});
});
