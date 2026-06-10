import { describe, expect, it } from "vitest";
import { isEcommerceReview } from "./ecommerce-review";
import type { FilterResult } from "./filter-result";

const r = (url: string, snippet = ""): FilterResult => ({
	id: "r",
	publishedDate: null,
	snippet,
	title: "t",
	url,
});

describe("isEcommerceReview", () => {
	it("matches known ecommerce / review hosts", () => {
		expect(isEcommerceReview(r("https://www.amazon.com/dp/B0001"))).toBe(true);
		expect(
			isEcommerceReview(r("https://www.g2.com/products/aglow/reviews")),
		).toBe(true);
	});
	it("matches product / cart path cues on any host", () => {
		expect(
			isEcommerceReview(r("https://shop.example.com/product/aglow-kit")),
		).toBe(true);
		expect(isEcommerceReview(r("https://store.example.com/checkout"))).toBe(
			true,
		);
	});
	it("matches buy/rating snippet cues", () => {
		expect(
			isEcommerceReview(
				r("https://example.com/x", "Add to cart — in stock now"),
			),
		).toBe(true);
	});
	it("does NOT match a genuine article on a news host", () => {
		expect(
			isEcommerceReview(
				r(
					"https://businessnews.com.au/article/aglow-raises",
					"Aglow announced funding today",
				),
			),
		).toBe(false);
	});
});
