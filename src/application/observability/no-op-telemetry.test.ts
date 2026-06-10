import { describe, expect, it, vi } from "vitest";
import { NoOpTelemetry } from "./no-op-telemetry";
import type { PipelineTelemetry } from "./pipeline-telemetry.port";

describe("NoOpTelemetry", () => {
	const telemetry: PipelineTelemetry = new NoOpTelemetry();

	it("externalCall runs fn and returns its value without throwing", async () => {
		const fn = vi.fn(async () => ({ failed: false, hits: [] }));
		const out = await telemetry.externalCall("tavily", "search", fn);
		expect(fn).toHaveBeenCalledOnce();
		expect(out).toEqual({ failed: false, hits: [] });
	});

	it("externalCall re-returns a benign-failure value verbatim (never converts it to a throw)", async () => {
		const out = await telemetry.externalCall(
			"anthropic",
			"web_search",
			async () => ({
				failed: true,
				hits: [],
			}),
		);
		expect(out).toEqual({ failed: true, hits: [] });
	});

	it("externalCall propagates a genuine throw from fn unchanged", async () => {
		await expect(
			telemetry.externalCall("brandfetch", "search", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
	});

	it("genAiCall runs fn and returns the unwrapped value (discards the GenAiCall metadata)", async () => {
		const out = await telemetry.genAiCall("snippet-verify", async () => ({
			call: {
				costUsd: 0.001,
				finishReasons: ["end_turn"],
				inputTokens: 1,
				model: "m",
				outputTokens: 2,
			},
			value: { entityMatchScore: 80 },
		}));
		expect(out).toEqual({ entityMatchScore: 80 });
	});

	it("recordResultEvent does nothing and never throws", () => {
		expect(() =>
			telemetry.recordResultEvent({ code: "off_topic", kind: "exclusion" }),
		).not.toThrow();
		expect(() =>
			telemetry.recordResultEvent({
				kind: "verification_flip",
				status: "uncertain",
			}),
		).not.toThrow();
		expect(() =>
			telemetry.recordResultEvent({ kind: "result_warning", warningType: "x" }),
		).not.toThrow();
	});
});
