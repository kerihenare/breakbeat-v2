import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize-url";

describe("normalizeUrl", () => {
	it("lowercases host, strips scheme, www, default port, trailing slash and fragment", () => {
		expect(normalizeUrl("HTTPS://WWW.Example.com:443/Article/?#top")).toBe(
			"example.com/Article",
		);
		expect(normalizeUrl("http://example.com/")).toBe("example.com");
	});

	it("keeps distinct paths and meaningful query strings distinct", () => {
		expect(normalizeUrl("https://news.site/a")).not.toBe(
			normalizeUrl("https://news.site/b"),
		);
		expect(normalizeUrl("https://site/p?id=1")).not.toBe(
			normalizeUrl("https://site/p?id=2"),
		);
	});

	it("strips tracking params and sorts the remaining query", () => {
		expect(normalizeUrl("https://site/p?id=1&utm_source=x&gclid=y")).toBe(
			normalizeUrl("https://site/p?id=1"),
		);
		expect(normalizeUrl("https://site/p?b=2&a=1")).toBe(
			normalizeUrl("https://site/p?a=1&b=2"),
		);
	});

	it("normalizes two forms of the same article to the same key", () => {
		expect(normalizeUrl("https://www.site.com/story?utm_campaign=z")).toBe(
			normalizeUrl("http://site.com/story/"),
		);
	});

	it("degrades a non-URL string without throwing", () => {
		expect(normalizeUrl("  Not A Url ")).toBe("not a url");
	});
});
