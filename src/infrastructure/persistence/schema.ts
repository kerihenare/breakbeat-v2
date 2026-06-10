import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
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
export const domainProvenanceEnum = pgEnum("domain_provenance", [
	"url_provided",
	"brand_derived",
]);
// Search Result provenance (telemetry / debugging only — never a precision signal).
export const resultSourceEnum = pgEnum("result_source", [
	"tavily",
	"web_search_backstop",
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
		// Append-only position within the Job's warning list. The (job_id, seq)
		// unique index makes warning sync idempotent under re-delivery: a re-saved
		// aggregate re-inserts every warning keyed by its position, and duplicates
		// are dropped by onConflictDoNothing rather than skipped by a positional
		// count (which could lose or duplicate a warning if a partial set landed).
		seq: integer("seq").notNull(),
		type: text("type").notNull(),
	},
	(t) => [
		index("warnings_job_id_idx").on(t.jobId),
		uniqueIndex("warnings_job_id_seq_uq").on(t.jobId, t.seq),
	],
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
		// Search writes this on every Result it inserts (Tavily vs the backstop).
		source: resultSourceEnum("source"),
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
 * The Resolve stage's durable output (PRD 2): one immutable, job-scoped Resolved
 * Identity per Job, written after assembly so PRD 7 / re-runs can read it. A
 * re-run is a new Job id with its own rows; Resolve never mutates a prior Job's
 * identity. The JSONB columns hold Zod-validated structured output only — never
 * raw BrandFetch payloads or scraped HTML (anti-echo, story 17).
 */
export const resolvedIdentities = pgTable("resolved_identity", {
	// BrandContext | null — the seven positioning fields, validated structured output.
	brandContext: jsonb("brand_context"),
	companyName: text("company_name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	jobId: uuid("job_id")
		.primaryKey()
		.references(() => jobs.id, { onDelete: "cascade" }),
	// The derived Negative Boost string; possibly empty (no collisions).
	negativeBoost: text("negative_boost").notNull().default(""),
});

export const resolvedIdentityOwnDomains = pgTable(
	"resolved_identity_own_domains",
	{
		domain: text("domain").notNull(),
		id: serial("id").primaryKey(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		provenance: domainProvenanceEnum("provenance").notNull(),
	},
	(t) => [index("resolved_identity_own_domains_job_id_idx").on(t.jobId)],
);

export const resolvedIdentityHandles = pgTable(
	"resolved_identity_handles",
	{
		handle: text("handle").notNull(),
		id: serial("id").primaryKey(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		platform: text("platform").notNull(),
		url: text("url").notNull(),
	},
	(t) => [index("resolved_identity_handles_job_id_idx").on(t.jobId)],
);

/**
 * The Summarise stage's durable output (PRD 6): one immutable, job-scoped
 * Job-level Summary per Job. `job_id` is the PRIMARY KEY (not a surrogate id),
 * which structurally enforces the one-Summary-per-Job rule — a second insert for
 * the same Job is a key conflict, not a silent duplicate. `summary` holds ONLY
 * the Zod-validated digest string — never raw model output, never snippet text
 * (anti-echo). A re-run is a new Job id with its own row.
 */
export const summaries = pgTable("summaries", {
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	jobId: uuid("job_id")
		.primaryKey()
		.references(() => jobs.id, { onDelete: "cascade" }),
	summary: text("summary").notNull(),
});

export const resolvedIdentityCollisions = pgTable(
	"resolved_identity_collisions",
	{
		brandId: text("brand_id"),
		// CollisionContext | null — validated structured output, never raw payloads.
		context: jsonb("context"),
		domain: text("domain").notNull(),
		id: serial("id").primaryKey(),
		jobId: uuid("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
	},
	(t) => [index("resolved_identity_collisions_job_id_idx").on(t.jobId)],
);
