import { z } from "zod";
import { CONTENT_TYPES } from "./content-type";
import { SENTIMENTS } from "./sentiment";

/**
 * The ADR 0003 structured-output contract for the ONE fused Haiku call. The response is validated
 * against this schema VERBATIM before anything is persisted; the parsed type is the only thing the
 * full-text pass acts on. `.strip()` discards any extra/injected fields (anti-echo). `takeaway` is the
 * one validated free-text field — non-empty and capped by the config-supplied max length.
 */
export function fusedAnalysisSchema(takeawayMaxLength: number) {
	return z
		.object({
			contentType: z.enum(CONTENT_TYPES), //               re-Classify
			entityMatchScore: z.number().min(0).max(100), //     re-Verify: final/authoritative Match Score
			sentiment: z.enum(SENTIMENTS), //                    Enhance: stance toward the TARGET
			takeaway: z.string().min(1).max(takeawayMaxLength), // Enhance: short per-Result takeaway
		})
		.strip();
}

export type FusedAnalysis = z.infer<ReturnType<typeof fusedAnalysisSchema>>;
