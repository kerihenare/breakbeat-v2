import { describe, expect, it } from "vitest";
import { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterResult } from "./filter-result";
import { isOwnChannel } from "./own-channel";

const identity = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
		socialHandles: [
			{
				handle: "aglow_app",
				platform: "instagram",
				url: "https://instagram.com/aglow_app",
			},
			{
				handle: "getaglow",
				platform: "linkedin",
				url: "https://www.linkedin.com/company/getaglow",
			},
		],
	});

const result = (
	url: string,
	over: Partial<FilterResult> = {},
): FilterResult => ({
	id: "r1",
	publishedDate: null,
	snippet: "s",
	title: "t",
	url,
	...over,
});

describe("isOwnChannel", () => {
	it("matches the company's own domain and its subdomains", () => {
		expect(isOwnChannel(result("https://getaglow.co/about"), identity())).toBe(
			true,
		);
		expect(
			isOwnChannel(result("https://blog.getaglow.co/post"), identity()),
		).toBe(true);
	});

	it("matches the company's named accounts on third-party platforms", () => {
		expect(
			isOwnChannel(result("https://www.instagram.com/aglow_app/"), identity()),
		).toBe(true);
		expect(
			isOwnChannel(
				result("https://www.linkedin.com/company/getaglow"),
				identity(),
			),
		).toBe(true);
	});

	it("does NOT match a third party's post mentioning the company (control, not authorship)", () => {
		expect(
			isOwnChannel(
				result("https://x.com/some_journalist/status/123"),
				identity(),
			),
		).toBe(false);
		expect(
			isOwnChannel(result("https://instagram.com/a_customer"), identity()),
		).toBe(false);
	});

	it("does NOT match a wire-distributed press release or a guest post on a third-party publication", () => {
		expect(
			isOwnChannel(
				result("https://www.prnewswire.com/news/aglow-raises"),
				identity(),
			),
		).toBe(false);
		expect(
			isOwnChannel(
				result("https://techcrunch.com/2026/01/02/aglow-guest-post"),
				identity(),
			),
		).toBe(false);
	});
});
