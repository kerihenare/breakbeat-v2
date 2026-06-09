import { describe, expect, it } from "vitest";
import { contentTypeView } from "./content-type.vm";
import { jobStatusView } from "./job-status.vm";
import { matchScoreView } from "./match-score.vm";
import { paginate } from "./pagination.vm";
import {
	exclusionReading,
	sentimentView,
	verificationReading,
} from "./readings";
import { resultRowView } from "./result-row.vm";

describe("matchScoreView", () => {
	it("reads NULL as 'Unverified' with an empty bar (not zero)", () => {
		expect(matchScoreView(null)).toEqual({
			barWidth: 0,
			isUnverified: true,
			reading: "Unverified",
			score: null,
		});
	});
	it("renders a numeric score and proportional bar, clamped to 0–100", () => {
		expect(matchScoreView(64)).toMatchObject({
			barWidth: 64,
			reading: "64",
			score: 64,
		});
		expect(matchScoreView(140)).toMatchObject({ barWidth: 100, score: 100 });
		expect(matchScoreView(-5)).toMatchObject({ score: 0 });
	});
});

describe("contentTypeView", () => {
	it("maps a known type to label + group + icon (colour never alone)", () => {
		const v = contentTypeView("news_article");
		expect(v).toMatchObject({
			group: "blue",
			icon: "newspaper",
			isUnclassified: false,
			label: "News article",
		});
	});
	it("reads NULL as 'Unclassified'", () => {
		expect(contentTypeView(null)).toMatchObject({
			isUnclassified: true,
			label: "Unclassified",
		});
	});
	it("falls back to 'Other' for an unknown type", () => {
		expect(contentTypeView("zzz")).toMatchObject({ label: "Other" });
	});
});

describe("verificationReading is independent of the score", () => {
	it("reads NULL verification as 'Unverified' even when a score is present", () => {
		expect(verificationReading(null)).toBe("Unverified");
		expect(matchScoreView(64).reading).toBe("64"); // score still shows
	});
	it("maps verified / uncertain", () => {
		expect(verificationReading("verified")).toBe("Verified");
		expect(verificationReading("uncertain")).toBe("Uncertain match");
	});
});

describe("jobStatusView", () => {
	it("distinguishes every state by label, not colour alone", () => {
		expect(jobStatusView("running")).toMatchObject({
			isRunning: true,
			isTerminal: false,
			label: "Researching…",
		});
		expect(jobStatusView("done")).toMatchObject({
			isTerminal: true,
			label: "Done",
		});
		expect(jobStatusView("done_with_warnings")).toMatchObject({
			label: "Done with warnings",
			tone: "warning",
		});
		expect(jobStatusView("failed")).toMatchObject({
			label: "Failed",
			tone: "failed",
		});
	});
});

describe("sentimentView", () => {
	it("maps sentiments and reads NULL as absent", () => {
		expect(sentimentView("positive")).toEqual({
			label: "Positive",
			tone: "green",
		});
		expect(sentimentView(null)).toBeNull();
	});
});

describe("paginate", () => {
	it("computes ranges, clamps the page, and flags ends", () => {
		expect(paginate(45, 1, 20)).toMatchObject({
			from: 1,
			hasNext: true,
			hasPrev: false,
			page: 1,
			to: 20,
			totalPages: 3,
		});
		expect(paginate(45, 3, 20)).toMatchObject({
			from: 41,
			hasNext: false,
			page: 3,
			to: 45,
		});
		expect(paginate(45, 99, 20)).toMatchObject({ page: 3 }); // clamped
	});
	it("handles an empty list", () => {
		expect(paginate(0, 1, 20)).toMatchObject({
			from: 0,
			hasNext: false,
			to: 0,
			totalPages: 1,
		});
	});
});

describe("resultRowView", () => {
	it("derives a full row view, sentiment present, included", () => {
		const view = resultRowView({
			contentType: "news_article",
			exclusionCode: null,
			exclusionDetail: null,
			id: "r1",
			matchScore: 92,
			publishedDate: new Date("2026-03-01T00:00:00Z"),
			sentiment: "positive",
			sourceDomain: "techcrunch.example",
			status: "included",
			title: "Aglow raises $20M",
			url: "https://techcrunch.example/x",
			verificationStatus: "verified",
		});
		expect(view).toMatchObject({
			date: "2026-03-01",
			exclusionReason: null,
			isExcluded: false,
			source: "techcrunch.example",
			title: "Aglow raises $20M",
			verification: "Verified",
		});
		expect(view.matchScore.score).toBe(92);
		expect(view.contentType.label).toBe("News article");
	});

	it("surfaces the exclusion reason for an excluded row and reads NULLs honestly", () => {
		const view = resultRowView({
			contentType: null,
			exclusionCode: "off_topic",
			exclusionDetail: "LLM",
			id: "r2",
			matchScore: null,
			publishedDate: null,
			sentiment: null,
			sourceDomain: null,
			status: "excluded",
			title: null,
			url: "https://x.example/y",
			verificationStatus: null,
		});
		expect(view.isExcluded).toBe(true);
		expect(view.exclusionReason).toBe("Off topic");
		expect(view.title).toBe("(untitled)");
		expect(view.date).toBe("—");
		expect(view.matchScore.reading).toBe("Unverified");
		expect(view.contentType.label).toBe("Unclassified");
		expect(view.sentiment).toBeNull();
	});
});

describe("exclusionReading", () => {
	it("labels each code and defaults safely", () => {
		expect(exclusionReading("own_channel")).toBe("Own channel");
		expect(exclusionReading("out_of_window")).toBe("Outside 36-month window");
		expect(exclusionReading(null)).toBe("Excluded");
	});
});
