import { type ContentType, readContentType } from "./null-readings";

/**
 * Content Type → { group (colour), iconKey (shape), label (text) } — three
 * redundant signals so colour is never alone (DESIGN.md). NULL reads
 * "Unclassified" in the neutral group; `other` reads "Other" in the same group
 * but with a distinct label. The group names map to the brand brights:
 * editorial→blue, written→green, social→pink, other→neutral ink.
 */
export type ContentTypeGroup = "editorial" | "written" | "social" | "other";
export type ContentTypeChip = {
	group: ContentTypeGroup;
	iconKey: string;
	label: string;
};

const GROUP: Record<ContentType, ContentTypeGroup> = {
	blog_post: "written",
	major_social_post: "social",
	news_article: "editorial",
	newsletter: "written",
	other: "other",
	podcast: "social",
	press_release: "editorial",
	trade_publication: "editorial",
};

const ICON_KEY: Record<ContentType, string> = {
	blog_post: "blog",
	major_social_post: "social",
	news_article: "news",
	newsletter: "newsletter",
	other: "other",
	podcast: "podcast",
	press_release: "press",
	trade_publication: "trade",
};

export function toContentTypeChip(
	type: ContentType | string | null,
): ContentTypeChip {
	if (type === null)
		return { group: "other", iconKey: "other", label: "Unclassified" };
	const known = (
		type in GROUP ? (type as ContentType) : "other"
	) as ContentType;
	return {
		group: GROUP[known],
		iconKey: ICON_KEY[known],
		label: readContentType(known),
	};
}
