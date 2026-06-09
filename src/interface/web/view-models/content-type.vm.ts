/**
 * Content Type → icon group + shape + label. Colour is NEVER the only signal
 * (DESIGN.md): every content type pairs a brand-bright group with a distinct
 * icon shape AND a text label. A NULL content type reads "Unclassified".
 */
export type IconGroup = "blue" | "green" | "pink" | "ink";

export interface ContentTypeView {
	readonly label: string;
	readonly group: IconGroup;
	readonly icon: string;
	readonly isUnclassified: boolean;
}

const VIEWS: Record<string, ContentTypeView> = {
	blog_post: {
		group: "green",
		icon: "pen-line",
		isUnclassified: false,
		label: "Blog post",
	},
	major_social_post: {
		group: "pink",
		icon: "at-sign",
		isUnclassified: false,
		label: "Social post",
	},
	news_article: {
		group: "blue",
		icon: "newspaper",
		isUnclassified: false,
		label: "News article",
	},
	newsletter: {
		group: "green",
		icon: "mail",
		isUnclassified: false,
		label: "Newsletter",
	},
	other: { group: "ink", icon: "file", isUnclassified: false, label: "Other" },
	podcast: {
		group: "pink",
		icon: "mic",
		isUnclassified: false,
		label: "Podcast",
	},
	press_release: {
		group: "ink",
		icon: "megaphone",
		isUnclassified: false,
		label: "Press release",
	},
	trade_publication: {
		group: "blue",
		icon: "briefcase",
		isUnclassified: false,
		label: "Trade publication",
	},
};

const UNCLASSIFIED: ContentTypeView = {
	group: "ink",
	icon: "help-circle",
	isUnclassified: true,
	label: "Unclassified",
};

export function contentTypeView(contentType: string | null): ContentTypeView {
	if (contentType === null) return UNCLASSIFIED;
	return VIEWS[contentType] ?? VIEWS.other;
}
