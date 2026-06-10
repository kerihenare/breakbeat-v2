import { describe, expect, it } from "vitest";
import { SEARCH_WARNING, searchWarnings } from "./search-warnings";

describe("search warnings", () => {
	it("exposes the closed set of search warning types", () => {
		expect(Object.values(SEARCH_WARNING).sort()).toEqual(
			["search.backstop_failed", "search.queries_partially_failed"].sort(),
		);
	});

	it("partial-failure builder records a count, never raw query text", () => {
		const w = searchWarnings.queriesPartiallyFailed(4);
		expect(w.type).toBe(SEARCH_WARNING.queriesPartiallyFailed);
		expect(w.message).toContain("4");
	});

	it("backstop-failed builder produces a non-empty message of the matching type", () => {
		const w = searchWarnings.backstopFailed();
		expect(w.type).toBe(SEARCH_WARNING.backstopFailed);
		expect(w.message.length).toBeGreaterThan(0);
	});
});
