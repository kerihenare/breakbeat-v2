/** The brief's seven Content Types, verbatim, plus the explicit escape hatch `other`. */
export const CONTENT_TYPES = [
	"news_article",
	"trade_publication",
	"blog_post",
	"press_release",
	"major_social_post",
	"newsletter",
	"podcast",
	"other",
] as const;

/** `other` is reserved for GENUINE ambiguity — a Result whose classify FAILED is left NULL, never `other`. */
export type ContentType = (typeof CONTENT_TYPES)[number];
