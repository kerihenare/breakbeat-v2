import { z } from "zod";

/** A boolean env flag: only the literal "true"/"1" is truthy. */
const boolFlag = z
	.string()
	.optional()
	.transform((v) => v === "true" || v === "1");

/**
 * Validated process environment. The app boots keyless (external API keys are
 * optional — a keyless clone still boots; see .env.example), but the backing
 * services (Postgres, Redis) are required.
 */
export const envSchema = z.object({
	// --- Analyze stage (PRD 5 — Verify / Classify / Enhance), Aglow-tuned cutoffs. ---
	ANALYZE_EXTRACT_CONCURRENCY: z.coerce.number().int().positive().default(5),
	ANALYZE_FULL_TEXT_T_EXCLUDE: z.coerce
		.number()
		.int()
		.nonnegative()
		.default(40),
	ANALYZE_SNIPPET_T_EXCLUDE: z.coerce.number().int().nonnegative().default(25),
	ANALYZE_T_VERIFIED: z.coerce.number().int().nonnegative().default(70),
	ANALYZE_TAKEAWAY_MAX_LENGTH: z.coerce.number().int().positive().default(400),
	// per-call timeout for the analyze Haiku calls (snippet gates + the fused full-text call).
	ANTHROPIC_ANALYZE_TIMEOUT_MS: z.coerce
		.number()
		.int()
		.positive()
		.default(15000),
	ANTHROPIC_API_KEY: z.string().optional().default(""),
	// Search's Anthropic web-search backstop model (one key, three Anthropic signals).
	ANTHROPIC_BACKSTOP_MODEL: z
		.string()
		.optional()
		.default("claude-haiku-4-5-20251001"),
	// The Haiku model id for the analyze snippet gates + the fused full-text call (ADR 0003).
	ANTHROPIC_HAIKU_MODEL: z
		.string()
		.optional()
		.default("claude-haiku-4-5-20251001"),
	// PRD 7 input-time autocomplete: a query shorter than this returns no
	// Brand Search suggestions (avoids a noisy listbox on the first keystroke).
	AUTOCOMPLETE_MIN_CHARS: z.coerce.number().int().positive().default(2),
	BRANDFETCH_API_KEY: z.string().optional().default(""),
	BRANDFETCH_BASE_URL: z
		.string()
		.optional()
		.default("https://api.brandfetch.io/v2"),
	BRANDFETCH_CLIENT_ID: z.string().optional().default(""),
	BRANDFETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
	DATABASE_URL: z.string().min(1),
	// Foundation-only scaffold flag (the throwaway demo stage). Superseded by
	// ResolveStage (PRD 2) as the first real stage; kept for the legacy scaffold path.
	DEMO_STAGE: boolFlag,
	// --- Filter stage (PRD 4) — deterministic heuristic + Collapse knobs, Aglow-tuned. ---
	FILTER_COLLAPSE_WINDOW_DAYS: z.coerce.number().int().positive().default(14),
	FILTER_HORIZON_MONTHS: z.coerce.number().int().positive().default(36),
	FILTER_MIN_CLUSTER_DOMAINS: z.coerce.number().int().positive().default(2),
	FILTER_MIN_DISTINCTIVE_TOKENS: z.coerce.number().int().positive().default(5),
	HOMEPAGE_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	OTEL_SDK_DISABLED: boolFlag,
	PORT: z.coerce.number().int().positive().default(3000),
	REDIS_URL: z.string().min(1),
	// Distinct broad Results below which Search escalation fires (ADR 0002; ~10, Aglow-tuned).
	SEARCH_LOW_YIELD_THRESHOLD: z.coerce.number().int().positive().default(10),
	SENTRY_DSN: z.string().optional().default(""),
	// --- Summarise stage (PRD 6 — the one-per-Job Job-level digest, one Haiku call per Job). ---
	// The tunable soft cap on the digest length the adapter enforces (≤ the schema hard ceiling).
	SUMMARISE_DIGEST_MAX_LENGTH: z.coerce.number().int().positive().default(1200),
	// The Haiku model id for the one-per-Job digest call.
	SUMMARISE_MODEL: z.string().optional().default("claude-haiku-4-5-20251001"),
	// per-call timeout for the digest.
	SUMMARISE_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
	TAVILY_API_KEY: z.string().optional().default(""),
	TAVILY_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	return envSchema.parse(source);
}
