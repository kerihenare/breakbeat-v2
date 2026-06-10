import { describe, expect, it } from "vitest";
import { selectSummariseInput } from "./select-input";
import type { SelectableResultRow } from "./summarise-input";

const row = (over: Partial<SelectableResultRow> = {}): SelectableResultRow => ({
	sentiment: "positive",
	snippet: "Aglow raised a seed round.",
	status: "included",
	takeaway: "Aglow is growing.",
	...over,
});

describe("selectSummariseInput", () => {
	it("shapes each surviving row into a SummariseInputItem and carries the company name", () => {
		const input = selectSummariseInput([row()], "Aglow");
		expect(input.companyName).toBe("Aglow");
		expect(input.items).toEqual([
			{
				sentiment: "positive",
				snippet: "Aglow raised a seed round.",
				takeaway: "Aglow is growing.",
			},
		]);
	});

	it("includes a surviving row with null Enhancement fields as snippet-only", () => {
		const input = selectSummariseInput(
			[row({ sentiment: null, takeaway: null })],
			"Aglow",
		);
		expect(input.items).toEqual([
			{
				sentiment: null,
				snippet: "Aglow raised a seed round.",
				takeaway: null,
			},
		]);
	});

	it("only `included` rows feed the digest — Excluded rows never appear (defence in depth)", () => {
		const rows = [
			row({ snippet: "keep me", status: "included" }),
			row({
				snippet: "tempting excluded snippet",
				status: "excluded",
				takeaway: "do not digest me",
			}),
			row({ snippet: "keep me too", status: "included" }),
		];
		const input = selectSummariseInput(rows, "Aglow");
		expect(input.items.map((i) => i.snippet)).toEqual([
			"keep me",
			"keep me too",
		]);
	});

	it("preserves the repository's order", () => {
		const rows = [
			row({ snippet: "first" }),
			row({ snippet: "second" }),
			row({ snippet: "third" }),
		];
		expect(
			selectSummariseInput(rows, "Aglow").items.map((i) => i.snippet),
		).toEqual(["first", "second", "third"]);
	});

	it("yields an empty items array for zero rows (the detectable empty case)", () => {
		expect(selectSummariseInput([], "Aglow").items).toHaveLength(0);
	});

	it("is pure: same inputs produce an equal output", () => {
		const rows = [row()];
		expect(selectSummariseInput(rows, "Aglow")).toEqual(
			selectSummariseInput(rows, "Aglow"),
		);
	});
});
