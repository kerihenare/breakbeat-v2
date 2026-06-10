import { describe, expect, it } from "vitest";
import { readContentType, readVerification } from "./null-readings";

describe("readVerification", () => {
	it("reads NULL verification_status as 'Unverified'", () => {
		expect(readVerification(null)).toBe("Unverified");
	});
	it("reads a real status as its human label", () => {
		expect(readVerification("verified")).toBe("Verified");
		expect(readVerification("uncertain")).toBe("Uncertain match");
	});
});

describe("readContentType", () => {
	it("reads NULL content_type as 'Unclassified'", () => {
		expect(readContentType(null)).toBe("Unclassified");
	});
	it("reads 'other' as 'Other' — a real stored value, distinct from NULL", () => {
		expect(readContentType("other")).toBe("Other");
		expect(readContentType("other")).not.toBe(readContentType(null));
	});
	it("reads each known content type as its label", () => {
		expect(readContentType("news_article")).toBe("News article");
		expect(readContentType("trade_publication")).toBe("Trade publication");
		expect(readContentType("press_release")).toBe("Press release");
		expect(readContentType("blog_post")).toBe("Blog post");
		expect(readContentType("newsletter")).toBe("Newsletter");
		expect(readContentType("major_social_post")).toBe("Major social post");
		expect(readContentType("podcast")).toBe("Podcast");
	});
});
