import { describe, expect, it } from "vitest";
import { FILTER_WARNING, filterWarnings } from "./filter-warnings";

describe("filter warnings", () => {
	it("exposes the closed set of filter warning types", () => {
		expect(Object.values(FILTER_WARNING)).toEqual([
			"filter.own_channel_degraded",
		]);
	});
	it("builds a non-echoing degraded-own-channel warning of the matching type", () => {
		const w = filterWarnings.ownChannelDegraded();
		expect(w.type).toBe(FILTER_WARNING.ownChannelDegraded);
		expect(w.message.length).toBeGreaterThan(0);
	});
});
