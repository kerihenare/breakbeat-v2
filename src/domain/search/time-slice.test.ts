import { describe, expect, it } from "vitest";
import { buildTimeSlices } from "./time-slice";

const NOW = new Date("2026-06-09T00:00:00.000Z");

describe("buildTimeSlices", () => {
	it("tiles 36 months back from now as 3 consecutive 12-month windows", () => {
		const slices = buildTimeSlices(NOW, 36, 12);
		expect(slices).toEqual([
			{ endDate: "2026-06-09", startDate: "2025-06-09" },
			{ endDate: "2025-06-09", startDate: "2024-06-09" },
			{ endDate: "2024-06-09", startDate: "2023-06-09" },
		]);
	});

	it("windows are contiguous and non-overlapping (each end == previous start)", () => {
		const slices = buildTimeSlices(NOW, 36, 12);
		expect(slices[0].startDate).toBe(slices[1].endDate);
		expect(slices[1].startDate).toBe(slices[2].endDate);
	});

	it("is deterministic for a pinned now", () => {
		expect(buildTimeSlices(NOW, 36, 12)).toEqual(buildTimeSlices(NOW, 36, 12));
	});
});
