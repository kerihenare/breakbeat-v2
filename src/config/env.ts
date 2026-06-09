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
	ANTHROPIC_API_KEY: z.string().optional().default(""),
	BRANDFETCH_API_KEY: z.string().optional().default(""),
	BRANDFETCH_CLIENT_ID: z.string().optional().default(""),
	DATABASE_URL: z.string().min(1),
	// Foundation-only scaffold flag (the throwaway demo stage). Removed when PRD 2 lands.
	DEMO_STAGE: boolFlag,
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	OTEL_SDK_DISABLED: boolFlag,
	PORT: z.coerce.number().int().positive().default(3000),
	REDIS_URL: z.string().min(1),
	SENTRY_DSN: z.string().optional().default(""),
	TAVILY_API_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
	return envSchema.parse(source);
}
