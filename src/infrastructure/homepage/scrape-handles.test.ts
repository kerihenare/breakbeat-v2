import { describe, expect, it } from "vitest";
import { scrapeHandles } from "./scrape-handles";

const html = `
  <a href="https://www.linkedin.com/company/getaglow">LinkedIn</a>
  <a href="https://x.com/getaglow">X</a>
  <a href="https://twitter.com/getaglow">Twitter</a>
  <a href="https://getaglow.substack.com">Substack</a>
  <a href="https://example.com/about">About</a>
`;

describe("scrapeHandles", () => {
	it("extracts known social platforms and ignores unrelated links", () => {
		const handles = scrapeHandles(html);
		const platforms = handles.map((h) => h.platform).sort();
		expect(platforms).toContain("linkedin");
		expect(platforms).toContain("x");
		expect(platforms).toContain("substack");
		expect(platforms).not.toContain("example");
	});

	it("dedups the same platform+handle", () => {
		const dupe = `<a href="https://x.com/getaglow">a</a><a href="https://x.com/getaglow">b</a>`;
		expect(scrapeHandles(dupe).filter((h) => h.platform === "x")).toHaveLength(
			1,
		);
	});

	it("returns [] for HTML with no social links", () => {
		expect(scrapeHandles("<p>no links</p>")).toEqual([]);
	});
});
