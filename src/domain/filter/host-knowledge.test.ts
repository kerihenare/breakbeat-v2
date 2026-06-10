import { describe, expect, it } from "vitest";
import {
	AGGREGATOR_HOSTS,
	accountKey,
	ECOMMERCE_REVIEW_HOSTS,
} from "./host-knowledge";

describe("host knowledge sets", () => {
	it("holds aggregator full-hosts and ecommerce registrable-domains", () => {
		expect(AGGREGATOR_HOSTS.has("news.google.com")).toBe(true);
		expect(ECOMMERCE_REVIEW_HOSTS.has("amazon.com")).toBe(true);
		expect(ECOMMERCE_REVIEW_HOSTS.has("g2.com")).toBe(true);
	});
});

describe("accountKey", () => {
	it("derives a stable {platform,id} for each supported platform", () => {
		expect(accountKey("https://www.linkedin.com/company/getaglow")).toEqual({
			id: "getaglow",
			platform: "linkedin",
		});
		expect(accountKey("https://x.com/getaglow")).toEqual({
			id: "getaglow",
			platform: "x",
		});
		expect(accountKey("https://twitter.com/getaglow/status/123")).toEqual({
			id: "getaglow",
			platform: "x",
		});
		expect(accountKey("https://www.instagram.com/aglow_app/")).toEqual({
			id: "aglow_app",
			platform: "instagram",
		});
		expect(accountKey("https://getaglow.substack.com/p/post")).toEqual({
			id: "getaglow",
			platform: "substack",
		});
		expect(
			accountKey("https://apps.apple.com/us/app/aglow/id123456789"),
		).toEqual({ id: "id123456789", platform: "appstore" });
		expect(
			accountKey(
				"https://play.google.com/store/apps/details?id=co.getaglow.app",
			),
		).toEqual({ id: "co.getaglow.app", platform: "playstore" });
	});

	it("returns null for a non-platform URL", () => {
		expect(
			accountKey("https://businessnews.com.au/article/aglow-raises"),
		).toBeNull();
		expect(accountKey("not a url")).toBeNull();
	});

	it("derives the same key from a Result URL and a scraped handle URL for one account", () => {
		expect(accountKey("https://x.com/getaglow/status/999")).toEqual(
			accountKey("https://x.com/getaglow"),
		);
	});
});
