import { describe, expect, it, vi } from "vitest";
import { ANALYZE_WARNING } from "../../domain/analyze/analyze-warnings";
import type { ContentType } from "../../domain/analyze/content-type";
import type { Sentiment } from "../../domain/analyze/sentiment";
import type { ExclusionCode } from "../../domain/filter/exclusion-code";
import { nameOnlyAnchor } from "../../domain/job/company-anchor";
import { Job } from "../../domain/job/job";
import { ResolvedIdentity } from "../../domain/resolve/resolved-identity";
import { RunContext } from "../pipeline/run-context";
import type {
	FilterResult,
	FullTextOutcome,
	ResultRepository,
} from "../search/ports/result-repository.port";
import { AnalyzeStage } from "./analyze.stage";
import type { AnalyzeConfig } from "./analyze-config";
import type { ContentExtractionPort } from "./ports/content-extraction.port";
import type { FullTextAnalysisPort } from "./ports/full-text-analysis.port";
import type { SnippetJudgementPort } from "./ports/snippet-judgement.port";

const config: AnalyzeConfig = {
	extractConcurrency: 5,
	fullTextTExclude: 40,
	snippetTExclude: 25,
	takeawayMaxLength: 400,
	tVerified: 70,
};

const richIdentity = () =>
	ResolvedIdentity.assemble({
		brandContext: {
			description: "Beauty startup",
			mission: null,
			productsAndServices: ["membership"],
			tagline: "Beauty membership",
			tags: ["beauty"],
			targetAudienceSegments: ["consumers"],
			valueProposition: "Membership beauty",
		},
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "Aglow International (ministry); Aglow Air (freighter)",
		ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
		socialHandles: [],
	});

const nameOnlyIdentity = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [],
		socialHandles: [],
	});

const makeRunningJob = (): Job => {
	const job = Job.create("job-1", nameOnlyAnchor("Aglow"), new Date());
	job.start(new Date());
	return job;
};

const poolRow = (over: Partial<FilterResult> = {}): FilterResult => ({
	id: "r1",
	publishedDate: "2026-01-02",
	snippet: "Aglow announced funding...",
	title: "Aglow raises a round",
	url: "https://news.example/aglow-funding",
	...over,
});

/** A fake repository recording every write so tests assert observable persisted facts. */
function fakeRepo(pool: FilterResult[]) {
	const interim = new Map<string, number>();
	const provisionalType = new Map<string, string>();
	const fullText = new Map<string, FullTextOutcome>();
	const extractedContent = new Map<string, string>();
	const exclusions: Array<{
		id: string;
		code: ExclusionCode;
		detail: string | null;
	}> = [];
	const repo: ResultRepository = {
		applyFullTextOutcome: vi.fn(
			async (id: string, outcome: FullTextOutcome) => {
				fullText.set(id, outcome);
			},
		),
		findIncluded: vi.fn(async () => pool),
		findIncludedForSummary: vi.fn(async () => []),
		insertIncluded: vi.fn(async () => 0),
		recordExclusion: vi.fn(
			async (id: string, code: ExclusionCode, detail: string | null) => {
				exclusions.push({ code, detail, id });
			},
		),
		setExtractedContent: vi.fn(async (id: string, content: string) => {
			extractedContent.set(id, content);
		}),
		setInterimMatchScore: vi.fn(async (id: string, score: number) => {
			interim.set(id, score);
		}),
		setProvisionalContentType: vi.fn(async (id: string, type) => {
			provisionalType.set(id, type);
		}),
	};
	return {
		exclusions,
		extractedContent,
		fullText,
		interim,
		provisionalType,
		repo,
	};
}

type Ports = {
	snippet: SnippetJudgementPort;
	extract: ContentExtractionPort;
	full: FullTextAnalysisPort;
};
const make = (ports: Ports, repo: ResultRepository) =>
	new AnalyzeStage(ports.snippet, ports.extract, ports.full, repo, config);

const runWith = async (
	ports: Ports,
	pool: FilterResult[],
	identity = richIdentity(),
) => {
	const f = fakeRepo(pool);
	const ctx = new RunContext(makeRunningJob());
	ctx.setResolvedIdentity(identity);
	await make(ports, f.repo).run(ctx);
	return { ctx, ...f };
};

describe("AnalyzeStage — Pass 1 (snippet gates + Extract gating)", () => {
	it("has name 'analyze'", () => {
		const ports: Ports = {
			extract: { extract: vi.fn() },
			full: { analyze: vi.fn() },
			snippet: { classifySnippet: vi.fn(), verifySnippet: vi.fn() },
		};
		const f = fakeRepo([]);
		expect(make(ports, f.repo).name).toBe("analyze");
	});

	it("throws a plain Error (programming fault) when resolvedIdentity is undefined", async () => {
		const ports: Ports = {
			extract: { extract: vi.fn() },
			full: { analyze: vi.fn() },
			snippet: { classifySnippet: vi.fn(), verifySnippet: vi.fn() },
		};
		const f = fakeRepo([]);
		const ctx = new RunContext(makeRunningJob()); // resolvedIdentity stays undefined
		await expect(make(ports, f.repo).run(ctx)).rejects.toThrow(
			/ResolvedIdentity/,
		);
	});

	it("snippet Exclude: interim score < snippet T_exclude → off_topic/'LLM', never Extracted, keeps provisional type", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({ kind: "extractionFailure" as const })),
			},
			full: { analyze: vi.fn() },
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "blog_post" as const,
				})),
				verifySnippet: vi.fn(async () => ({ interimMatchScore: 10 })), // < 25
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.exclusions).toEqual([
			{ code: "off_topic", detail: "LLM", id: "r1" },
		]);
		expect(out.interim.get("r1")).toBe(10); // interim rung kept
		expect(out.provisionalType.get("r1")).toBe("blog_post"); // snippet-Classify rode along
		expect(ports.extract.extract).not.toHaveBeenCalled(); // the cost gate
		expect(ports.full.analyze).not.toHaveBeenCalled();
	});

	it("no brand context: records one no_brand_context Warning and still runs with brandContext null", async () => {
		const verifySnippet = vi.fn(async () => ({ interimMatchScore: 80 }));
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({
					fullText: "page",
					kind: "extracted" as const,
				})),
			},
			full: {
				analyze: vi.fn(async () => ({
					contentType: "news_article" as const,
					entityMatchScore: 80,
					sentiment: "neutral" as const,
					takeaway: "t",
				})),
			},
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "news_article" as const,
				})),
				verifySnippet,
			},
		};
		const out = await runWith(ports, [poolRow()], nameOnlyIdentity());
		expect(out.ctx.job.warnings.map((w) => w.type)).toContain(
			ANALYZE_WARNING.noBrandContext,
		);
		expect(verifySnippet).toHaveBeenCalledWith(
			expect.objectContaining({ brandContext: null }),
		);
	});

	it("snippet-Classify failure: content_type left NULL, one snippet_classify_failed Warning, still proceeds to Extract", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({ kind: "extractionFailure" as const })),
			}, // skip fused call
			full: { analyze: vi.fn() },
			snippet: {
				classifySnippet: vi.fn(async () => ({ failed: true as const })),
				verifySnippet: vi.fn(async () => ({ interimMatchScore: 80 })), // survives
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.provisionalType.has("r1")).toBe(false); // NULL
		expect(out.ctx.job.warnings.map((w) => w.type)).toContain(
			ANALYZE_WARNING.snippetClassifyFailed,
		);
		expect(ports.extract.extract).toHaveBeenCalledWith(
			"https://news.example/aglow-funding",
		); // proceeded
	});

	it("snippet-Verify failure: no interim rung written, proceeds to Extract (a failed cheap gate must not Exclude)", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({ kind: "extractionFailure" as const })),
			},
			full: { analyze: vi.fn() },
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "news_article" as const,
				})),
				verifySnippet: vi.fn(async () => ({ failed: true as const })),
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.interim.has("r1")).toBe(false); // provisional Tavily score stands
		expect(out.exclusions).toEqual([]); // a failed cheap gate never Excludes
		expect(ports.extract.extract).toHaveBeenCalledTimes(1); // proceeded to Extract
	});

	it("empty pool: returns normally, no writes (honest empty finding)", async () => {
		const ports: Ports = {
			extract: { extract: vi.fn() },
			full: { analyze: vi.fn() },
			snippet: { classifySnippet: vi.fn(), verifySnippet: vi.fn() },
		};
		const out = await runWith(ports, []);
		expect(out.exclusions).toEqual([]);
		expect(ports.snippet.verifySnippet).not.toHaveBeenCalled();
	});
});

describe("AnalyzeStage — Pass 2 (Extract + fused full-text call)", () => {
	const surviving = { interimMatchScore: 80 }; // ≥ snippet T_exclude → survives the snippet gate

	it("snippet survive → full-text verify: interim then FINAL score (overwrite), verified, re-Classified, Enhanced in one write", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({
					fullText: "the full page text",
					kind: "extracted" as const,
				})),
			},
			full: {
				analyze: vi.fn(async () => ({
					contentType: "news_article" as ContentType,
					entityMatchScore: 88,
					sentiment: "positive" as Sentiment,
					takeaway: "Aglow raised a Series A.",
				})),
			},
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "blog_post" as const,
				})),
				verifySnippet: vi.fn(async () => surviving),
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.interim.get("r1")).toBe(80); // interim rung written first
		expect(out.extractedContent.get("r1")).toBe("the full page text"); // persisted on Extract success
		expect(out.fullText.get("r1")).toEqual({
			contentType: "news_article",
			matchScore: 88, // final rung overwrites interim
			sentiment: "positive",
			takeaway: "Aglow raised a Series A.",
			verificationStatus: "verified", // ≥ tVerified
		});
		expect(out.exclusions).toEqual([]);
	});

	it("snippet survive → full-text Exclude (the look-alike the snippet let through): off_topic at the STRICT cutoff", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({
					fullText: "freighter logistics page",
					kind: "extracted" as const,
				})),
			},
			full: {
				analyze: vi.fn(async () => ({
					contentType: "news_article" as ContentType,
					entityMatchScore: 30, // < fullTextTExclude (40) → exclude on the page (the flip)
					sentiment: "neutral" as Sentiment,
					takeaway: "Different company.",
				})),
			},
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "news_article" as const,
				})),
				verifySnippet: vi.fn(async () => surviving), // 80 survives lenient snippet gate
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.exclusions).toEqual([
			{ code: "off_topic", detail: "LLM", id: "r1" },
		]);
		expect(out.fullText.has("r1")).toBe(false); // no Enhance write on an Excluded row
	});

	it("Extract failure: stays included, interim score + provisional type kept, verification_status NULL, extract_failed Warning, fused call never invoked", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({ kind: "extractionFailure" as const })),
			},
			full: { analyze: vi.fn() },
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "trade_publication" as const,
				})),
				verifySnippet: vi.fn(async () => surviving),
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.interim.get("r1")).toBe(80);
		expect(out.provisionalType.get("r1")).toBe("trade_publication");
		expect(out.fullText.has("r1")).toBe(false); // NULL verification_status (never written)
		expect(out.extractedContent.has("r1")).toBe(false); // Extract failed → extracted_content left NULL
		expect(out.exclusions).toEqual([]); // Extract failure is NEVER an Exclusion
		expect(out.ctx.job.warnings.map((w) => w.type)).toContain(
			ANALYZE_WARNING.extractFailed,
		);
		expect(ports.full.analyze).not.toHaveBeenCalled();
	});

	it("fused-call failure: stays included, NULL status, full_text_classify_failed + enhance_failed Warnings", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({
					fullText: "page",
					kind: "extracted" as const,
				})),
			},
			full: { analyze: vi.fn(async () => ({ failed: true as const })) },
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "podcast" as const,
				})),
				verifySnippet: vi.fn(async () => surviving),
			},
		};
		const out = await runWith(ports, [poolRow()]);
		expect(out.fullText.has("r1")).toBe(false);
		expect(out.provisionalType.get("r1")).toBe("podcast"); // provisional type kept
		const types = out.ctx.job.warnings.map((w) => w.type);
		expect(types).toContain(ANALYZE_WARNING.fullTextClassifyFailed);
		expect(types).toContain(ANALYZE_WARNING.enhanceFailed);
	});

	it("total Classify failure: no Result carries any content_type → one classify_totally_failed Warning, Job not failed", async () => {
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => ({
					fullText: "page",
					kind: "extracted" as const,
				})),
			},
			full: { analyze: vi.fn(async () => ({ failed: true as const })) }, // no full-text type either
			snippet: {
				classifySnippet: vi.fn(async () => ({ failed: true as const })), // no provisional type
				verifySnippet: vi.fn(async () => surviving),
			},
		};
		const out = await runWith(ports, [
			poolRow(),
			poolRow({ id: "r2", url: "https://news.example/2" }),
		]);
		expect(out.ctx.job.warnings.map((w) => w.type)).toContain(
			ANALYZE_WARNING.classifyTotallyFailed,
		);
		// The Job is not failed: run() returned normally (no throw).
	});

	it("bounded concurrency: in-flight Extract calls never exceed config.extractConcurrency", async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const ports: Ports = {
			extract: {
				extract: vi.fn(async () => {
					inFlight += 1;
					maxInFlight = Math.max(maxInFlight, inFlight);
					await new Promise((r) => setTimeout(r, 1));
					inFlight -= 1;
					return { fullText: "page", kind: "extracted" as const };
				}),
			},
			full: {
				analyze: vi.fn(async () => ({
					contentType: "news_article" as ContentType,
					entityMatchScore: 80,
					sentiment: "neutral" as Sentiment,
					takeaway: "t",
				})),
			},
			snippet: {
				classifySnippet: vi.fn(async () => ({
					contentType: "news_article" as const,
				})),
				verifySnippet: vi.fn(async () => surviving),
			},
		};
		const pool = Array.from({ length: 20 }, (_, i) =>
			poolRow({ id: `r${i}`, url: `https://news.example/${i}` }),
		);
		await runWith(ports, pool);
		expect(maxInFlight).toBeLessThanOrEqual(config.extractConcurrency);
	});
});
