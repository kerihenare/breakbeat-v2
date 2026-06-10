import { describe, expect, it } from "vitest";
import { type JobState, toStatusBadge } from "./job-status.vm";

describe("toStatusBadge", () => {
	it("maps every JobState to a label + tone + dotKind (non-colour-only)", () => {
		expect(toStatusBadge("pending")).toMatchObject({
			dotKind: "idle",
			label: "Pending",
			tone: "neutral",
		});
		expect(toStatusBadge("running")).toMatchObject({
			dotKind: "pulse",
			label: "Researching…",
			tone: "info",
		});
		expect(toStatusBadge("done")).toMatchObject({
			dotKind: "solid",
			label: "Done",
			tone: "success",
		});
		expect(toStatusBadge("done_with_warnings")).toMatchObject({
			dotKind: "solid",
			label: "Done · warnings",
			tone: "warning",
		});
		expect(toStatusBadge("failed")).toMatchObject({
			dotKind: "solid",
			label: "Failed",
			tone: "error",
		});
	});

	it("flags terminal and running states for the page-state logic", () => {
		expect(toStatusBadge("running").isRunning).toBe(true);
		expect(toStatusBadge("running").isTerminal).toBe(false);
		expect(toStatusBadge("done").isTerminal).toBe(true);
		expect(toStatusBadge("done_with_warnings").isTerminal).toBe(true);
		expect(toStatusBadge("failed").isTerminal).toBe(true);
		expect(toStatusBadge("pending").isTerminal).toBe(false);
	});

	it("carries a distinct label for every state (the word is the non-colour signal)", () => {
		const labels = (
			["pending", "running", "done", "done_with_warnings", "failed"] as const
		).map((s: JobState) => toStatusBadge(s).label);
		expect(new Set(labels).size).toBe(5);
	});
});
