import { describe, expect, it, vi } from "vitest";
import { warnIfBlind } from "./startup-check";

describe("warnIfBlind", () => {
	it("warns when OTEL_SDK_DISABLED=true", () => {
		const warn = vi.fn();
		warnIfBlind(
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
				OTEL_SDK_DISABLED: "true",
			},
			warn,
		);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toMatch(/disabled|off|blind/i);
	});

	it("warns when the OTLP endpoint is unset", () => {
		const warn = vi.fn();
		warnIfBlind({ OTEL_EXPORTER_OTLP_ENDPOINT: "" }, warn);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toMatch(/endpoint/i);
	});

	it("is silent when enabled and the endpoint is set", () => {
		const warn = vi.fn();
		warnIfBlind({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }, warn);
		expect(warn).not.toHaveBeenCalled();
	});
});
