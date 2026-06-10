import { describe, expect, it } from "vitest";
import { toContentTypeChip } from "./content-type.vm";

describe("toContentTypeChip", () => {
	it("maps editorial types to the editorial group with a per-type icon shape and label", () => {
		expect(toContentTypeChip("news_article")).toEqual({
			group: "editorial",
			iconKey: "news",
			label: "News article",
		});
		expect(toContentTypeChip("trade_publication")).toEqual({
			group: "editorial",
			iconKey: "trade",
			label: "Trade publication",
		});
		expect(toContentTypeChip("press_release")).toEqual({
			group: "editorial",
			iconKey: "press",
			label: "Press release",
		});
	});

	it("maps written types to the written group", () => {
		expect(toContentTypeChip("blog_post")).toEqual({
			group: "written",
			iconKey: "blog",
			label: "Blog post",
		});
		expect(toContentTypeChip("newsletter")).toEqual({
			group: "written",
			iconKey: "newsletter",
			label: "Newsletter",
		});
	});

	it("maps social types to the social group", () => {
		expect(toContentTypeChip("major_social_post")).toEqual({
			group: "social",
			iconKey: "social",
			label: "Major social post",
		});
		expect(toContentTypeChip("podcast")).toEqual({
			group: "social",
			iconKey: "podcast",
			label: "Podcast",
		});
	});

	it("maps 'other' and the NULL reading to the neutral group with distinct labels", () => {
		expect(toContentTypeChip("other")).toEqual({
			group: "other",
			iconKey: "other",
			label: "Other",
		});
		expect(toContentTypeChip(null)).toEqual({
			group: "other",
			iconKey: "other",
			label: "Unclassified",
		});
	});

	it("every chip carries a non-empty label and iconKey (never colour alone)", () => {
		for (const t of [
			"news_article",
			"blog_post",
			"podcast",
			"other",
			null,
		] as const) {
			const chip = toContentTypeChip(t);
			expect(chip.label.length).toBeGreaterThan(0);
			expect(chip.iconKey.length).toBeGreaterThan(0);
		}
	});
});
