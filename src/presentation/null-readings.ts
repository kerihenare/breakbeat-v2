/**
 * NULL readings (PRD 7 §NULL-state labelling). "Unverified" / "Unclassified"
 * are *readings* of NULL computed at render — never stored, never written back.
 * `other` is a real stored value reading "Other", distinct from the NULL
 * "Unclassified".
 */

/** The closed Verification status set written by the Verify stage; NULL = "hasn't been verified". */
export type VerificationStatus = "verified" | "uncertain";

/** The closed Content Type set written by the Classify stage; NULL = "hasn't been classified". */
export type ContentType =
	| "news_article"
	| "trade_publication"
	| "press_release"
	| "blog_post"
	| "newsletter"
	| "major_social_post"
	| "podcast"
	| "other";

const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
	uncertain: "Uncertain match",
	verified: "Verified",
};

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
	blog_post: "Blog post",
	major_social_post: "Major social post",
	news_article: "News article",
	newsletter: "Newsletter",
	other: "Other",
	podcast: "Podcast",
	press_release: "Press release",
	trade_publication: "Trade publication",
};

/** Reading of `verification_status`: a real status → its label; NULL → "Unverified" (computed, never stored). */
export function readVerification(status: VerificationStatus | null): string {
	return status === null ? "Unverified" : VERIFICATION_LABELS[status];
}

/** Reading of `content_type`: a real type → its label; NULL → "Unclassified" ("other" is distinct, reads "Other"). */
export function readContentType(type: ContentType | string | null): string {
	if (type === null) return "Unclassified";
	return CONTENT_TYPE_LABELS[type as ContentType] ?? "Other";
}
