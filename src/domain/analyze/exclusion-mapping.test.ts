import { describe, expect, it } from "vitest";
import { LLM_CATCHER, OFF_TOPIC, offTopicExclusion } from "./exclusion-mapping";

describe("offTopicExclusion", () => {
	it("is exactly { code: 'off_topic', detail: 'LLM' }", () => {
		expect(offTopicExclusion()).toEqual({ code: "off_topic", detail: "LLM" });
	});

	it("exposes the constants the stage uses (the catcher, never model text)", () => {
		expect(OFF_TOPIC).toBe("off_topic");
		expect(LLM_CATCHER).toBe("LLM");
	});

	it("takes no model output by design — there is nowhere for model text to enter the exclusion write", () => {
		// @ts-expect-error structural anti-echo proof: the builder accepts no arguments.
		offTopicExclusion("attacker chosen text");
		expect(offTopicExclusion().detail).toBe("LLM");
	});

	it("never produces any other exclusion code", () => {
		const forbidden = [
			"own_channel",
			"aggregator",
			"ecommerce_review",
			"out_of_window",
			"duplicate",
			"llm_excluded",
		];
		expect(forbidden).not.toContain(offTopicExclusion().code);
	});
});
