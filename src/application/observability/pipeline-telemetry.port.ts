// NO OTel types may appear in this file. It is the hexagonal seam: adapters and
// stages depend on this interface; the OTel implementation lives in infrastructure.
import type { ExclusionCode } from "../../domain/filter/exclusion-code";

/** The external systems whose calls become child spans. Closed set. */
export type ExternalSystem = "anthropic" | "tavily" | "brandfetch";

/** A GenAI call's anti-echo-safe metadata. There is NO field for prompt/completion/scraped text. */
export type GenAiCall = {
	readonly model: string; // → gen_ai.request.model
	readonly inputTokens: number; // → gen_ai.usage.input_tokens
	readonly outputTokens: number; // → gen_ai.usage.output_tokens
	readonly finishReasons: readonly string[]; // → gen_ai.response.finish_reasons
	readonly costUsd: number; // derived cost attribute
};

/** An outlier per-Result outcome recorded as a span EVENT (never a span). Carries only domain data. */
export type ResultEvent =
	| { readonly kind: "exclusion"; readonly code: ExclusionCode } // exclusion_code only, never the detail text
	| {
			readonly kind: "verification_flip";
			readonly status: "verified" | "uncertain";
	  }
	| { readonly kind: "result_warning"; readonly warningType: string }; // warning.type

export interface PipelineTelemetry {
	/** Mints a child span on the active Stage Span; awaits fn; records latency + outcome; never throws. */
	externalCall<T>(
		system: ExternalSystem,
		op: string,
		fn: () => Promise<T>,
	): Promise<T>;
	/** As externalCall, but stamps OTel GenAI attributes + derived cost and accrues tokens/cost to the Stage Span. */
	genAiCall<T>(
		op: string,
		fn: () => Promise<{ value: T; call: GenAiCall }>,
	): Promise<T>;
	/** Records an outlier per-Result outcome as a span EVENT on the active Stage Span (no span). Best-effort. */
	recordResultEvent(event: ResultEvent): void;
}

export const PIPELINE_TELEMETRY = Symbol("PipelineTelemetry");
