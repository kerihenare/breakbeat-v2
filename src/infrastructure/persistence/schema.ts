import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

/**
 * The durable schema (Foundation design §Schema). All four concerns are defined
 * now so the shape is stable; PRD 1 only WRITES `jobs` and `warnings`. `results`
 * and `resolved_identity` are created with their invariants but no domain object
 * populates them yet — the load-bearing invariants (frozen anchor, born-included
 * Result, closed exclusion-code set, warning-presence-drives-terminal-state) are
 * fixed here. Later stages add their own columns/children via their own migrations.
 */

export const jobStateEnum = pgEnum("job_state", [
	"pending",
	"running",
	"done",
	"done_with_warnings",
	"failed",
]);
export const anchorKindEnum = pgEnum("anchor_kind", [
	"disambiguated",
	"name_only",
]);
export const anchorProvenanceEnum = pgEnum("anchor_provenance", [
	"picked",
	"url_provided",
	"name_only",
]);

export const resultStatusEnum = pgEnum("result_status", [
	"included",
	"excluded",
]);
export const exclusionCodeEnum = pgEnum("exclusion_code", [
	"own_channel",
	"aggregator",
	"ecommerce_review",
	"out_of_window",
	"duplicate",
	"off_topic",
]);
export const verificationStatusEnum = pgEnum("verification_status", [
	"verified",
	"uncertain",
]);
export const contentTypeEnum = pgEnum("content_type", [
	"news_article",
	"trade_publication",
	"blog_post",
	"press_release",
	"major_social_post",
	"newsletter",
	"podcast",
	"other",
]);
export const sentimentEnum = pgEnum("sentiment", [
	"positive",
	"neutral",
	"negative",
]);

export const jobs = pgTable(
	"jobs",
	{
		anchorBrandId: text("anchor_brand_id"),
		anchorDomain: text("anchor_domain"),
		// Frozen company anchor — written once at submit, never updated.
		anchorKind: anchorKindEnum("anchor_kind").notNull(),
		anchorName: text("anchor_name"),
		anchorProvenance: anchorProvenanceEnum("anchor_provenance").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		failureReason: text("failure_reason"),
		id: uuid("id").primaryKey(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		state: jobStateEnum("state").notNull().default("pending"),
		terminalAt: timestamp("terminal_at", { withTimezone: true }),
	},
	(t) => [index("jobs_created_at_idx").on(t.createdAt)],
);

export const warnings = pgTable(
	"warnings",
	{
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		id: uuid("id").primaryKey().defaultRandom(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		message: text("message").notNull(),
		type: text("type").notNull(),
	},
	(t) => [index("warnings_job_id_idx").on(t.jobId)],
);

export const results = pgTable(
	"results",
	{
		contentType: contentTypeEnum("content_type"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		exclusionCode: exclusionCodeEnum("exclusion_code"),
		// Records the *catcher* (e.g. "LLM"), never model free text — the anti-echo channel.
		exclusionDetail: text("exclusion_detail"),
		extractedContent: text("extracted_content"),
		id: uuid("id").primaryKey().defaultRandom(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		// Nullable stage columns — NULL = "hasn't reached that stage", never a sentinel.
		matchScore: integer("match_score"),
		// Search's insert-time URL dedup is the (job_id, normalized_url) unique index.
		normalizedUrl: text("normalized_url").notNull(),
		publishedDate: timestamp("published_date", { withTimezone: true }),
		sentiment: sentimentEnum("sentiment"),
		snippet: text("snippet"),
		sourceDomain: text("source_domain"),
		// Born `included`; the only legal transition is to `excluded`.
		status: resultStatusEnum("status").notNull().default("included"),
		takeaway: text("takeaway"),
		title: text("title"),
		url: text("url").notNull(),
		verificationStatus: verificationStatusEnum("verification_status"),
	},
	(t) => [
		uniqueIndex("results_job_normalized_url_uq").on(t.jobId, t.normalizedUrl),
		index("results_job_match_score_idx").on(t.jobId, t.matchScore),
		// An excluded Result must carry a code; an included one must not (the
		// born-included / →excluded-only rule, enforced in storage).
		check(
			"results_exclusion_code_consistency",
			sql`(${t.status} = 'excluded' AND ${t.exclusionCode} IS NOT NULL) OR (${t.status} = 'included' AND ${t.exclusionCode} IS NULL)`,
		),
		// Match Score is a 0–100 ordering key when present.
		check(
			"results_match_score_range",
			sql`${t.matchScore} IS NULL OR (${t.matchScore} >= 0 AND ${t.matchScore} <= 100)`,
		),
	],
);

/**
 * Reserved for PRD 2 (Resolve). Foundation creates only this minimal parent
 * placeholder keyed by `job_id`; the Resolve migration owns the substantive
 * columns and child tables. Do not flesh this out here.
 */
export const resolvedIdentities = pgTable("resolved_identity", {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	jobId: uuid("job_id")
		.primaryKey()
		.references(() => jobs.id, { onDelete: "cascade" }),
});
