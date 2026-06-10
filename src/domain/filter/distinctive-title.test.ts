import { describe, expect, it } from "vitest";
import { isDistinctive } from "./distinctive-title";
import type { FilterConfig } from "./filter-config";
import { normalizeTitle } from "./normalize-title";

const config: FilterConfig = {
	collapseWindowDays: 14,
	horizonMonths: 36,
	minClusterDomains: 2,
	minDistinctiveTokens: 5,
};

describe("isDistinctive", () => {
	it("rejects a bare company name or a generic phrase as a collapse key", () => {
		expect(isDistinctive(normalizeTitle("Aglow"), "Aglow", config)).toBe(false);
		expect(
			isDistinctive(normalizeTitle("Funding Announcement"), "Aglow", config),
		).toBe(false);
		expect(
			isDistinctive(normalizeTitle("Aglow — Company News"), "Aglow", config),
		).toBe(false);
	});

	it("accepts a distinctive, identifying title", () => {
		const key = normalizeTitle(
			"Aglow raises $5M seed round to expand beauty membership platform nationwide",
		);
		expect(isDistinctive(key, "Aglow", config)).toBe(true);
	});
});
