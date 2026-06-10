import { describe, expect, it } from "vitest";
import { RESOLVE_WARNING, resolveWarnings } from "./resolve-warnings";

describe("resolve warnings", () => {
	it("exposes the closed set of resolve warning types", () => {
		expect(Object.values(RESOLVE_WARNING).sort()).toEqual(
			[
				"resolve.brand_context_absent",
				"resolve.collision_context_fetch_failed",
				"resolve.collision_target_inferred",
				"resolve.homepage_fetch_failed",
				"resolve.homepage_unresolved",
			].sort(),
		);
	});

	it("builders produce a Warning with the matching type and a non-empty message", () => {
		const w = resolveWarnings.homepageUnresolved();
		expect(w.type).toBe(RESOLVE_WARNING.homepageUnresolved);
		expect(w.message.length).toBeGreaterThan(0);
	});

	it("collision fetch failure builder records a count, never scraped text", () => {
		const w = resolveWarnings.collisionContextFetchFailed(3);
		expect(w.type).toBe(RESOLVE_WARNING.collisionContextFetchFailed);
		expect(w.message).toContain("3");
	});
});
