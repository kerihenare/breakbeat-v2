import { describe, expect, it } from "vitest";
import type { ContentTypeCount } from "../../../application/ports/read-models.port";
import { deriveChips } from "./chips.vm";

const counts: ContentTypeCount[] = [
	{ contentType: "news_article", count: 3 },
	{ contentType: "trade_publication", count: 3 },
	{ contentType: "blog_post", count: 2 },
	{ contentType: "newsletter", count: 1 },
	{ contentType: "major_social_post", count: 2 },
];

describe("deriveChips", () => {
	it("emits an 'All' chip first carrying the total included count", () => {
		const chips = deriveChips(counts, null);
		expect(chips[0]).toMatchObject({
			count: 11,
			disabled: false,
			key: "all",
			selected: true,
		});
	});

	it("emits one chip per canonical content type in fixed order", () => {
		const keys = deriveChips(counts, null)
			.filter((c) => c.key !== "all")
			.map((c) => c.key);
		expect(keys).toEqual([
			"news_article",
			"trade_publication",
			"blog_post",
			"press_release",
			"major_social_post",
			"newsletter",
			"podcast",
			"other",
		]);
	});

	it("disables zero-count types and never marks them selected", () => {
		const chips = deriveChips(counts, null);
		const podcast = chips.find((c) => c.key === "podcast");
		expect(podcast).toMatchObject({
			count: 0,
			disabled: true,
			selected: false,
		});
		// press_release is absent from counts → 0 → disabled
		expect(chips.find((c) => c.key === "press_release")).toMatchObject({
			count: 0,
			disabled: true,
		});
	});

	it("marks the selected type and de-selects 'All'", () => {
		const chips = deriveChips(counts, "blog_post");
		expect(chips.find((c) => c.key === "all")?.selected).toBe(false);
		expect(chips.find((c) => c.key === "blog_post")?.selected).toBe(true);
	});

	it("surfaces an 'Unclassified' chip only when the NULL bucket has rows", () => {
		const withNull = deriveChips(
			[...counts, { contentType: "unclassified", count: 4 }],
			"unclassified",
		);
		expect(withNull.find((c) => c.key === "unclassified")).toMatchObject({
			count: 4,
			disabled: false,
			selected: true,
		});
		expect(
			deriveChips(counts, null).find((c) => c.key === "unclassified"),
		).toBeUndefined();
	});

	it("includes the NULL bucket in the 'All' total", () => {
		const chips = deriveChips(
			[...counts, { contentType: "unclassified", count: 4 }],
			null,
		);
		expect(chips.find((c) => c.key === "all")?.count).toBe(15);
	});
});
