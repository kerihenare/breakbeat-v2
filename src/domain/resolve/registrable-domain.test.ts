import { describe, expect, it } from "vitest";
import { registrableDomain } from "./registrable-domain";

describe("registrableDomain", () => {
	it("lowercases and strips scheme, www, port, and path", () => {
		expect(registrableDomain("https://www.GetAglow.co/about?x=1")).toBe(
			"getaglow.co",
		);
		expect(registrableDomain("getaglow.co:443")).toBe("getaglow.co");
		expect(registrableDomain("HTTP://Aglow.ORG/")).toBe("aglow.org");
	});

	it("returns empty string for null/blank input", () => {
		expect(registrableDomain(null)).toBe("");
		expect(registrableDomain("  ")).toBe("");
	});

	it("matches two forms of the same host", () => {
		expect(registrableDomain("www.homeaglow.com")).toBe(
			registrableDomain("https://homeaglow.com/jobs"),
		);
	});
});
