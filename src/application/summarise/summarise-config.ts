export type SummariseConfig = {
	/** The Haiku model id (SUMMARISE_MODEL). */
	model: string;
	/** The per-call timeout (SUMMARISE_TIMEOUT_MS). */
	timeoutMs: number;
	/** The tunable soft cap the adapter enforces (SUMMARISE_DIGEST_MAX_LENGTH); ≤ SUMMARY_HARD_MAX_LENGTH. */
	digestMaxLength: number;
};

export const SUMMARISE_CONFIG = Symbol("SummariseConfig");
