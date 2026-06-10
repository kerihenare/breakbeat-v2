import type { ContentTypeCount } from "../../../application/ports/read-models.port";
import { type ContentTypeView, contentTypeView } from "./content-type.vm";

/** A content-type filter chip on the Result page. */
export interface FilterChip {
	readonly key: string; // "all" | a content type | "unclassified"
	readonly label: string;
	readonly count: number;
	readonly view: ContentTypeView | null; // null only for the "All" chip
	readonly selected: boolean;
	readonly disabled: boolean;
}

/** Fixed canonical order — matches the content_type enum and the included-list ordering. */
const CANONICAL = [
	"news_article",
	"trade_publication",
	"blog_post",
	"press_release",
	"major_social_post",
	"newsletter",
	"podcast",
	"other",
] as const;

/**
 * The content-type filter chips for a Job's included Results. "All" comes first
 * carrying the total; then one chip per canonical content type in fixed order
 * (a zero-count type is `disabled` and never `selected`); an "Unclassified" chip
 * appears only when the NULL-content-type bucket has rows. Counts are over ALL
 * included rows (the `countsByContentType` read), so they never shift with the
 * active filter. `selectedType === null` selects "All".
 */
export function deriveChips(
	counts: readonly ContentTypeCount[],
	selectedType: string | null,
): FilterChip[] {
	const countOf = (key: string) =>
		counts.find((c) => c.contentType === key)?.count ?? 0;
	const total = counts.reduce((sum, c) => sum + c.count, 0);

	const chips: FilterChip[] = [
		{
			count: total,
			disabled: false,
			key: "all",
			label: "All",
			selected: selectedType === null,
			view: null,
		},
	];

	for (const type of CANONICAL) {
		const count = countOf(type);
		chips.push({
			count,
			disabled: count === 0,
			key: type,
			label: contentTypeView(type).label,
			selected: selectedType === type,
			view: contentTypeView(type),
		});
	}

	const unclassified = countOf("unclassified");
	if (unclassified > 0) {
		chips.push({
			count: unclassified,
			disabled: false,
			key: "unclassified",
			label: "Unclassified",
			selected: selectedType === "unclassified",
			view: contentTypeView(null),
		});
	}

	return chips;
}
