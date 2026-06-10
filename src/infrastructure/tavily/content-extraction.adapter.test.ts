import { describe, expect, it, vi } from "vitest";
import { TavilyContentExtractionAdapter } from "./content-extraction.adapter";

// A fake matching @tavily/core's client surface: { extract(urls, options) }.
const fakeClient = (impl: (urls: unknown, opts: unknown) => unknown) => ({
	extract: vi.fn(impl),
});
const adapter = (client: unknown) =>
	new TavilyContentExtractionAdapter(client as never, 15000);

describe("TavilyContentExtractionAdapter", () => {
	it("maps a successful Extract to { kind: 'extracted', fullText }", async () => {
		const client = fakeClient(async () => ({
			results: [
				{ rawContent: "the full page text", url: "https://news.example/a" },
			],
		}));
		expect(await adapter(client).extract("https://news.example/a")).toEqual({
			fullText: "the full page text",
			kind: "extracted",
		});
	});

	it("passes the single URL to the client", async () => {
		const client = fakeClient(async () => ({
			results: [{ rawContent: "x", url: "https://news.example/a" }],
		}));
		await adapter(client).extract("https://news.example/a");
		expect(client.extract).toHaveBeenCalledWith(
			["https://news.example/a"],
			expect.any(Object),
		);
	});

	it("returns { kind: 'extractionFailure' } on an empty extraction (no results)", async () => {
		const client = fakeClient(async () => ({ results: [] }));
		expect(await adapter(client).extract("https://news.example/a")).toEqual({
			kind: "extractionFailure",
		});
	});

	it("returns { kind: 'extractionFailure' } when the page text is empty", async () => {
		const client = fakeClient(async () => ({
			results: [{ rawContent: "", url: "https://news.example/a" }],
		}));
		expect(await adapter(client).extract("https://news.example/a")).toEqual({
			kind: "extractionFailure",
		});
	});

	it("returns { kind: 'extractionFailure' } when the client throws (quota/network/timeout), never a throw", async () => {
		const client = fakeClient(async () => {
			throw new Error("quota");
		});
		expect(await adapter(client).extract("https://news.example/a")).toEqual({
			kind: "extractionFailure",
		});
	});

	it("returns { kind: 'extractionFailure' } when the response fails to parse", async () => {
		const client = fakeClient(async () => ({ unexpected: true }));
		expect(await adapter(client).extract("https://news.example/a")).toEqual({
			kind: "extractionFailure",
		});
	});
});
