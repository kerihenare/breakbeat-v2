import { describe, expect, it } from "vitest";
import { BACKSTOP_PROVISIONAL_SCORE } from "../../domain/search/provisional-score";
import type { NormalizedHit } from "./ports/tavily-search.port";
import { toResultInsert } from "./to-result-insert";

const hit = (over: Partial<NormalizedHit> = {}): NormalizedHit => ({
	publishedDate: "2026-01-02",
	relevance: 0.8,
	snippet: "Aglow announced funding...",
	title: "Aglow raises a round",
	url: "https://www.example.com/story/?utm_source=x",
	...over,
});

describe("toResultInsert", () => {
	it("maps a Tavily hit: provisional score from relevance, normalized url, passed-through date", () => {
		const r = toResultInsert(hit(), "tavily");
		expect(r.matchScore).toBe(80);
		expect(r.normalizedUrl).toBe("example.com/story");
		expect(r.url).toBe("https://www.example.com/story/?utm_source=x");
		expect(r.publishedDate).toBe("2026-01-02");
		expect(r.source).toBe("tavily");
	});

	it("maps a backstop hit to the floor score and backstop source", () => {
		const r = toResultInsert(
			hit({ publishedDate: null, relevance: null }),
			"web_search_backstop",
		);
		expect(r.matchScore).toBe(BACKSTOP_PROVISIONAL_SCORE);
		expect(r.publishedDate).toBeNull();
		expect(r.source).toBe("web_search_backstop");
	});

	it("never carries a verification status (Search writes provisional only)", () => {
		expect("verificationStatus" in toResultInsert(hit(), "tavily")).toBe(false);
	});
});
