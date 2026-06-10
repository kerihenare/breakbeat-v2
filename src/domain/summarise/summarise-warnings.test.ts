import { describe, expect, it } from "vitest";
import { SUMMARISE_WARNING, summariseWarnings } from "./summarise-warnings";

describe("summarise warnings", () => {
	it("exposes the closed set of summarise warning types, namespaced under `summarise.`", () => {
		expect(Object.values(SUMMARISE_WARNING).sort()).toEqual(
			["summarise.summarise_empty", "summarise.summarise_failed"].sort(),
		);
	});

	it("empty-case builder produces a non-empty message of the matching type", () => {
		const w = summariseWarnings.summariseEmpty();
		expect(w.type).toBe(SUMMARISE_WARNING.summariseEmpty);
		expect(w.message.length).toBeGreaterThan(0);
	});

	it("failed builder produces a non-empty message of the matching type", () => {
		const w = summariseWarnings.summariseFailed();
		expect(w.type).toBe(SUMMARISE_WARNING.summariseFailed);
		expect(w.message.length).toBeGreaterThan(0);
	});
});
