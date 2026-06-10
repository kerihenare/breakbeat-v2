import type {
	Counter,
	Histogram,
	Meter,
	ObservableGauge,
} from "@opentelemetry/api";

// --- Closed label sets (the ONLY shapes any record-method accepts) ---
export type ServiceLabel = "breakbeat-web" | "breakbeat-worker";
export type StageLabel =
	| "resolve"
	| "search"
	| "filter"
	| "analyze"
	| "summarise";
export type TerminalStateLabel = "done" | "done_with_warnings" | "failed";
export type ExternalServiceLabel = "anthropic" | "tavily" | "brandfetch";
export type ExternalOutcomeLabel = "ok" | "failed";
export type ExclusionCodeLabel =
	| "own_channel"
	| "aggregator"
	| "ecommerce_review"
	| "out_of_window"
	| "duplicate"
	| "off_topic";
export type ContentTypeLabel =
	| "news_article"
	| "trade_publication"
	| "press_release"
	| "blog_post"
	| "newsletter"
	| "major_social_post"
	| "podcast"
	| "other"
	| "unclassified";

/**
 * The named instruments from PRD 8. Instrument types are CONTRACT (they fix the
 * Prometheus/Mimir series suffixes). Every record-method takes a closed-enum
 * label object only — there is no parameter through which job.id, the company
 * anchor, or a URL could be passed (a Mimir cardinality bomb).
 */
export class MetricsRegistry {
	private readonly jobDuration: Histogram;
	private readonly stageDuration: Histogram;
	private readonly jobCompleted: Counter;
	private readonly llmTokens: Counter;
	private readonly llmCost: Counter;
	private readonly externalRequest: Counter;
	private readonly results: Counter;
	private readonly warnings: Counter;
	private queueDepth: ObservableGauge | null = null;

	constructor(private readonly meter: Meter) {
		this.jobDuration = meter.createHistogram("job.duration", { unit: "ms" });
		this.stageDuration = meter.createHistogram("stage.duration", {
			unit: "ms",
		});
		this.jobCompleted = meter.createCounter("job.completed");
		this.llmTokens = meter.createCounter("llm.tokens");
		this.llmCost = meter.createCounter("llm.cost", { unit: "usd" });
		this.externalRequest = meter.createCounter("external.request");
		this.results = meter.createCounter("results");
		this.warnings = meter.createCounter("warnings");
	}

	recordJobDuration(
		ms: number,
		l: { terminalState: TerminalStateLabel; service: ServiceLabel },
	): void {
		this.jobDuration.record(ms, {
			service: l.service,
			terminal_state: l.terminalState,
		});
	}

	recordStageDuration(
		ms: number,
		l: { stage: StageLabel; service: ServiceLabel },
	): void {
		this.stageDuration.record(ms, { service: l.service, stage: l.stage });
	}

	incJobCompleted(l: {
		terminalState: TerminalStateLabel;
		service: ServiceLabel;
	}): void {
		this.jobCompleted.add(1, {
			service: l.service,
			terminal_state: l.terminalState,
		});
	}

	incLlmTokens(
		tokens: number,
		l: { model: string; stage: StageLabel; service: ServiceLabel },
	): void {
		this.llmTokens.add(tokens, {
			model: l.model,
			service: l.service,
			stage: l.stage,
		});
	}

	incLlmCost(
		usd: number,
		l: { model: string; stage: StageLabel; service: ServiceLabel },
	): void {
		this.llmCost.add(usd, {
			model: l.model,
			service: l.service,
			stage: l.stage,
		});
	}

	incExternalRequest(l: {
		system: ExternalServiceLabel;
		stage: StageLabel;
		outcome: ExternalOutcomeLabel;
	}): void {
		this.externalRequest.add(1, {
			outcome: l.outcome,
			service: l.system,
			stage: l.stage,
		});
	}

	incResults(l: {
		exclusionCode: ExclusionCodeLabel | "included";
		contentType: ContentTypeLabel;
		stage: StageLabel;
	}): void {
		this.results.add(1, {
			content_type: l.contentType,
			exclusion_code: l.exclusionCode,
			stage: l.stage,
		});
	}

	incWarnings(l: { stage: StageLabel; warningType: string }): void {
		this.warnings.add(1, { stage: l.stage, "warning.type": l.warningType });
	}

	/** Register the observable gauge. The callback is re-read by the SDK on every metric collection. */
	observeQueueDepth(read: () => number, l: { service: ServiceLabel }): void {
		if (this.queueDepth) return;
		this.queueDepth = this.meter.createObservableGauge("queue.depth");
		this.queueDepth.addCallback((obs) =>
			obs.observe(read(), { service: l.service }),
		);
	}
}

export const METRICS_REGISTRY = Symbol("MetricsRegistry");
