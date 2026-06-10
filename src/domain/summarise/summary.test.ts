import { describe, expect, it } from "vitest";
import { type Summary, summarySchema } from "./summary";

describe("summarySchema", () => {
	it("accepts a trimmed, non-empty digest string", () => {
		const parsed = summarySchema.parse({
			summary: "Aglow's coverage is broadly positive.",
		});
		expect(parsed).toEqual({
			summary: "Aglow's coverage is broadly positive.",
		});
	});

	it("trims surrounding whitespace", () => {
		expect(summarySchema.parse({ summary: "  digest  " })).toEqual({
			summary: "digest",
		});
	});

	it("rejects an empty or whitespace-only summary", () => {
		expect(summarySchema.safeParse({ summary: "" }).success).toBe(false);
		expect(summarySchema.safeParse({ summary: "   " }).success).toBe(false);
	});

	it("rejects an over-long summary (the hard ceiling)", () => {
		expect(summarySchema.safeParse({ summary: "x".repeat(4001) }).success).toBe(
			false,
		);
	});

	it("strips unexpected extra fields (anti-echo: only the digest is kept)", () => {
		const parsed = summarySchema.parse({
			injected: "ignore me",
			summary: "digest",
		} as never);
		expect(parsed).toEqual({ summary: "digest" });
		expect("injected" in parsed).toBe(false);
	});

	it("the inferred Summary type is { summary: string }", () => {
		const s: Summary = { summary: "digest" };
		expect(s.summary).toBe("digest");
	});
});
