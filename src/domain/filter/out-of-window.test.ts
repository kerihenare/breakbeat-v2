import { describe, expect, it } from "vitest";
import { isOutOfWindow } from "./out-of-window";

const NOW = new Date("2026-06-09T00:00:00.000Z");

describe("isOutOfWindow", () => {
	it("excludes a date older than the 36-month horizon", () => {
		expect(isOutOfWindow("2022-01-01", NOW, 36)).toBe(true);
	});
	it("keeps a date inside the horizon", () => {
		expect(isOutOfWindow("2026-01-01", NOW, 36)).toBe(false);
		expect(isOutOfWindow("2023-07-01", NOW, 36)).toBe(false);
	});
	it("never excludes a NULL date (we don't guess a missing date into a rejection)", () => {
		expect(isOutOfWindow(null, NOW, 36)).toBe(false);
	});
	it("degrades an unparseable date to not-excluded", () => {
		expect(isOutOfWindow("not-a-date", NOW, 36)).toBe(false);
	});
});
