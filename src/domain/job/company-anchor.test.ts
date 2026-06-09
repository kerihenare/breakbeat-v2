import { describe, expect, it } from "vitest";
import {
	disambiguatedAnchor,
	InvalidAnchorError,
	nameOnlyAnchor,
} from "./company-anchor";

describe("disambiguatedAnchor", () => {
	it("builds from a domain alone (url_provided provenance)", () => {
		const a = disambiguatedAnchor({
			domain: "aglow.example",
			provenance: "url_provided",
		});
		expect(a).toEqual({
			brandId: null,
			domain: "aglow.example",
			kind: "disambiguated",
			provenance: "url_provided",
		});
	});

	it("builds from a brandId alone (picked provenance)", () => {
		const a = disambiguatedAnchor({
			brandId: "brand_123",
			provenance: "picked",
		});
		expect(a.kind).toBe("disambiguated");
		if (a.kind === "disambiguated") {
			expect(a.brandId).toBe("brand_123");
			expect(a.domain).toBeNull();
		}
	});

	it("rejects an anchor with neither domain nor brandId", () => {
		expect(() => disambiguatedAnchor({ provenance: "picked" })).toThrow(
			InvalidAnchorError,
		);
		expect(() =>
			disambiguatedAnchor({ brandId: "", domain: "  ", provenance: "picked" }),
		).toThrow(InvalidAnchorError);
	});

	it("is frozen (immutable for the life of the Job)", () => {
		const a = disambiguatedAnchor({
			domain: "aglow.example",
			provenance: "picked",
		});
		expect(Object.isFrozen(a)).toBe(true);
		expect(() => {
			(a as { domain: string }).domain = "evil.example";
		}).toThrow();
	});
});

describe("nameOnlyAnchor", () => {
	it("builds the explicit degraded fallback with name_only provenance", () => {
		const a = nameOnlyAnchor("  Aglow  ");
		expect(a).toEqual({
			kind: "name_only",
			name: "Aglow",
			provenance: "name_only",
		});
		expect(Object.isFrozen(a)).toBe(true);
	});

	it("rejects a blank name", () => {
		expect(() => nameOnlyAnchor("   ")).toThrow(InvalidAnchorError);
	});
});
