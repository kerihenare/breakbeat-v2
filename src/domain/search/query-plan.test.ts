import { describe, expect, it } from "vitest";
import { ResolvedIdentity } from "../resolve/resolved-identity";
import { buildQueryPlan } from "./query-plan";

const NOW = new Date("2026-06-09T00:00:00.000Z");
const config = { horizonMonths: 36, windowMonths: 12 };

const richIdentity = () =>
	ResolvedIdentity.assemble({
		brandContext: {
			description: "Beauty startup",
			mission: null,
			productsAndServices: ["membership"],
			tagline: "Beauty membership",
			tags: ["beauty"],
			targetAudienceSegments: ["consumers"],
			valueProposition: "Membership beauty",
		},
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [{ domain: "getaglow.co", provenance: "url_provided" }],
		socialHandles: [],
	});

const nameOnlyIdentity = () =>
	ResolvedIdentity.assemble({
		brandContext: null,
		companyName: "Aglow",
		nameCollisions: [],
		negativeBoost: "",
		ownDomains: [],
		socialHandles: [],
	});

describe("buildQueryPlan", () => {
	it("always produces a broad set built from the company name", () => {
		const plan = buildQueryPlan(richIdentity(), NOW, config);
		expect(plan.broad.length).toBeGreaterThan(0);
		expect(plan.broad.every((q) => q.kind === "broad")).toBe(true);
		expect(plan.broad.some((q) => q.text.includes("Aglow"))).toBe(true);
		expect(plan.broad.every((q) => q.timeSlice === null)).toBe(true);
	});

	it("still yields a usable broad set for a name-only degraded identity", () => {
		const plan = buildQueryPlan(nameOnlyIdentity(), NOW, config);
		expect(plan.broad.length).toBeGreaterThan(0);
		expect(plan.broad.some((q) => q.text.includes("Aglow"))).toBe(true);
	});

	it("emits event-type angle queries unsliced", () => {
		const plan = buildQueryPlan(richIdentity(), NOW, config);
		const events = plan.angle.filter((q) =>
			/funding|acquisition|partnership/.test(q.text),
		);
		expect(events.length).toBeGreaterThan(0);
		expect(events.every((q) => q.timeSlice === null)).toBe(true);
	});

	it("emits news and press-release angles once per 12-month window with start/end dates", () => {
		const plan = buildQueryPlan(richIdentity(), NOW, config);
		const news = plan.angle.filter((q) => /news/i.test(q.text));
		expect(news).toHaveLength(3); // one per 12-month window over 36 months
		expect(news.every((q) => q.timeSlice !== null)).toBe(true);
		expect(news.map((q) => q.timeSlice?.endDate)).toContain("2026-06-09");

		const pr = plan.angle.filter((q) => /press release/i.test(q.text));
		expect(pr).toHaveLength(3);
		expect(pr.every((q) => q.timeSlice !== null)).toBe(true);
	});

	it("emits exactly the podcast and newsletter type-targeted long-tail", () => {
		const plan = buildQueryPlan(richIdentity(), NOW, config);
		const texts = plan.typeTargeted.map((q) => q.text);
		expect(plan.typeTargeted.every((q) => q.kind === "type_targeted")).toBe(
			true,
		);
		expect(texts.some((t) => /podcast/i.test(t))).toBe(true);
		expect(texts.some((t) => /newsletter/i.test(t))).toBe(true);
	});

	it("is pure: same inputs produce an equal plan", () => {
		expect(buildQueryPlan(richIdentity(), NOW, config)).toEqual(
			buildQueryPlan(richIdentity(), NOW, config),
		);
	});
});
