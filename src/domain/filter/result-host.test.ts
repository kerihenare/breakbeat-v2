import { describe, expect, it } from "vitest";
import { registrableDomain, resultHost } from "./result-host";

describe("resultHost", () => {
	it("returns the lowercased host without port", () => {
		expect(resultHost("HTTPS://News.Example.com:443/a/b")).toBe(
			"news.example.com",
		);
	});
	it("degrades a non-URL to an empty string (never throws)", () => {
		expect(resultHost("not a url")).toBe("");
	});
});

describe("registrableDomain", () => {
	it("reduces a subdomain to its registrable parent", () => {
		expect(registrableDomain("blog.getaglow.co")).toBe("getaglow.co");
		expect(registrableDomain("www.getaglow.co")).toBe("getaglow.co");
		expect(registrableDomain("getaglow.co")).toBe("getaglow.co");
	});
	it("keeps three labels for a known multi-part public suffix", () => {
		expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
		expect(registrableDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
	});
});
