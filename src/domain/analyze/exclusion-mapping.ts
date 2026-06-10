/** The single exclusion_code analyze ever writes. */
export const OFF_TOPIC = "off_topic" as const;
/** The exclusion_detail — the CATCHER string, never any text the model emitted (anti-echo). */
export const LLM_CATCHER = "LLM" as const;

/**
 * The only Exclusion this stage produces: `off_topic` with `exclusion_detail = "LLM"`, at EITHER pass
 * when classifyScore returns { kind: "exclude" }. It never writes own_channel / aggregator /
 * ecommerce_review / out_of_window / duplicate (Filter's), and never `llm_excluded` (not a code).
 * Takes no model output by design — the structural proof there is no echo channel into the write.
 */
export function offTopicExclusion(): {
	readonly code: typeof OFF_TOPIC;
	readonly detail: typeof LLM_CATCHER;
} {
	return { code: OFF_TOPIC, detail: LLM_CATCHER };
}
