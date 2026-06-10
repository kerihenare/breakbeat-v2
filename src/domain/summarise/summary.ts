import { z } from "zod";

/**
 * The hard ceiling the schema enforces. The config-tunable soft cap
 * (SummariseConfig.digestMaxLength) is enforced by the adapter; this ceiling
 * guarantees a runaway response can never reach the DB.
 */
export const SUMMARY_HARD_MAX_LENGTH = 4000;

/**
 * The one Job-level digest (CONTEXT.md: the Result page's "Enhancement details
 * summary", NEVER a "result summary"). `summarySchema` is the ONLY gate model
 * output crosses — `.strip()` drops any extra fields so no raw model free-text
 * leaks past the boundary (anti-echo). A re-run produces a fresh Summary; there
 * is never more than one live Summary for a Job.
 */
export const summarySchema = z
	.object({
		summary: z.string().trim().min(1).max(SUMMARY_HARD_MAX_LENGTH),
	})
	.strip();

export type Summary = z.infer<typeof summarySchema>; // { summary: string }
