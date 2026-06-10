import { describe, expect, it } from "vitest";
import { shouldEscalate } from "./escalation";

describe("shouldEscalate", () => {
	it("escalates when distinct broad Results are below the threshold", () => {
		expect(shouldEscalate(0, 10)).toBe(true);
		expect(shouldEscalate(9, 10)).toBe(true);
	});

	it("does not escalate at or above the threshold (boundary)", () => {
		expect(shouldEscalate(10, 10)).toBe(false);
		expect(shouldEscalate(25, 10)).toBe(false);
	});

	it("measures DISTINCT post-dedup Results, not raw hits (documented semantics)", () => {
		// The caller passes the count of rows actually inserted (post-URL-dedup).
		// Many raw hits that dedup down to 3 distinct Results still escalate
		// against a threshold of 10.
		const distinctAfterDedup = 3;
		expect(shouldEscalate(distinctAfterDedup, 10)).toBe(true);
	});
});
