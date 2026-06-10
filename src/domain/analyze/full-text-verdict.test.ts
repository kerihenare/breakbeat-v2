import { describe, expect, it } from "vitest";
import { decideFullText } from "./full-text-verdict";
import type { Cutoffs } from "./verification-status";

const FULL_TEXT: Cutoffs = { tExclude: 40, tVerified: 70 };

const analysis = (
	over: Partial<Parameters<typeof decideFullText>[0]> = {},
) => ({
	contentType: "news_article" as const,
	entityMatchScore: 88,
	sentiment: "positive" as const,
	takeaway: "Aglow raised a round.",
	...over,
});

describe("decideFullText", () => {
	it("excludes below the strict cutoff (the Verification flip — no write)", () => {
		expect(
			decideFullText(analysis({ entityMatchScore: 30 }), FULL_TEXT),
		).toEqual({
			kind: "exclude",
		});
	});

	it("writes the final rung + verified status + re-Classify + Enhance at/above tVerified", () => {
		expect(
			decideFullText(analysis({ entityMatchScore: 88 }), FULL_TEXT),
		).toEqual({
			kind: "write",
			write: {
				contentType: "news_article",
				matchScore: 88, // ratcheted final rung
				sentiment: "positive",
				takeaway: "Aglow raised a round.",
				verificationStatus: "verified",
			},
		});
	});

	it("writes uncertain status in the middle band and rounds the final rung", () => {
		const out = decideFullText(analysis({ entityMatchScore: 55.6 }), FULL_TEXT);
		expect(out).toEqual({
			kind: "write",
			write: {
				contentType: "news_article",
				matchScore: 56, // rounded
				sentiment: "positive",
				takeaway: "Aglow raised a round.",
				verificationStatus: "uncertain",
			},
		});
	});
});
