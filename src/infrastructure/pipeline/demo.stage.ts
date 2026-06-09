import type { RunContext } from "../../application/pipeline/run-context";
import type { Stage } from "../../application/pipeline/stage.port";
import { warning } from "../../domain/job/warning";
import type { Database } from "../persistence/database";
import { results } from "../persistence/schema";

/**
 * THROWAWAY scaffold stage (gated by DEMO_STAGE=true). It is NOT Resolve and
 * NOT any real pipeline stage — it exists only so the Foundation tracer bullet
 * exercises the runner with a non-empty ordered list, proves the
 * `done_with_warnings` path end-to-end, and gives the Result page real, varied
 * rows to render before the real stages (PRDs 2–6) land. Remove when PRD 2 ships
 * (tracked in beads). It writes synthetic Results directly via the schema's
 * reserved columns; born-`included` except one demonstrative `excluded` row.
 */
export class DemoStage implements Stage {
	readonly name = "demo";

	constructor(private readonly db: Database) {}

	async run(ctx: RunContext): Promise<void> {
		const jobId = ctx.job.id;
		await this.db.insert(results).values([
			{
				contentType: "news_article",
				jobId,
				matchScore: 94,
				normalizedUrl: "techcrunch.example/aglow-series-a",
				publishedDate: new Date("2026-03-12T00:00:00Z"),
				sentiment: "positive",
				snippet:
					"The startup says the round will fund expansion across North America.",
				sourceDomain: "techcrunch.example",
				takeaway: "Strong funding signal; clearly about the target company.",
				title:
					"Aglow raises $20M Series A to scale its beauty-membership platform",
				url: "https://techcrunch.example/aglow-series-a",
				verificationStatus: "verified",
			},
			{
				contentType: "trade_publication",
				jobId,
				matchScore: 78,
				normalizedUrl: "beautymatter.example/aglow-profile",
				publishedDate: new Date("2026-01-20T00:00:00Z"),
				sentiment: "neutral",
				snippet: "How the membership economics actually work.",
				sourceDomain: "beautymatter.example",
				takeaway: "Useful industry context on the business model.",
				title: "Inside Aglow's subscription model: a trade deep-dive",
				url: "https://beautymatter.example/aglow-profile",
				verificationStatus: "verified",
			},
			{
				contentType: null,
				jobId,
				// Extract failed here: still included, interim score, but Unverified + Unclassified.
				matchScore: 61,
				normalizedUrl: "someblog.example/tried-aglow",
				publishedDate: new Date("2025-11-02T00:00:00Z"),
				sentiment: null,
				snippet: "A long-form personal account.",
				sourceDomain: "someblog.example",
				takeaway: null,
				title: "I tried Aglow for three months — here's my honest take",
				url: "https://someblog.example/tried-aglow",
				verificationStatus: null,
			},
			{
				exclusionCode: "off_topic",
				exclusionDetail: "LLM",
				jobId,
				normalizedUrl: "aglow-ministry.example/news",
				publishedDate: new Date("2026-02-01T00:00:00Z"),
				snippet: "A same-name organisation, not the target company.",
				sourceDomain: "aglow-ministry.example",
				// A look-alike caught by Verify's full-text re-pass.
				status: "excluded",
				title: "Aglow International announces global prayer conference",
				url: "https://aglow-ministry.example/news",
			},
		]);

		ctx.recordWarning(
			warning(
				"demo_stage",
				"Demo stage active (DEMO_STAGE=true) — Results are synthetic scaffold data, not a real search.",
			),
		);
	}
}
