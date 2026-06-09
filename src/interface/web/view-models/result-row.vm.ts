import type { ResultReadRow } from "../../../application/ports/read-models.port";
import { type ContentTypeView, contentTypeView } from "./content-type.vm";
import { type MatchScoreView, matchScoreView } from "./match-score.vm";
import {
	exclusionReading,
	formatDate,
	formatDomain,
	type SentimentView,
	sentimentView,
	verificationReading,
} from "./readings";

/** The fully-derived view for one flat Result row (DESIGN.md signature component). */
export interface ResultRowView {
	readonly id: string;
	readonly title: string;
	readonly url: string;
	readonly source: string;
	readonly date: string;
	readonly matchScore: MatchScoreView;
	readonly contentType: ContentTypeView;
	readonly verification: string;
	readonly sentiment: SentimentView | null;
	readonly isExcluded: boolean;
	readonly exclusionReason: string | null;
}

export function resultRowView(row: ResultReadRow): ResultRowView {
	return {
		contentType: contentTypeView(row.contentType),
		date: formatDate(row.publishedDate),
		exclusionReason:
			row.status === "excluded" ? exclusionReading(row.exclusionCode) : null,
		id: row.id,
		isExcluded: row.status === "excluded",
		matchScore: matchScoreView(row.matchScore),
		sentiment: sentimentView(row.sentiment),
		source: formatDomain(row.sourceDomain),
		title: row.title ?? "(untitled)",
		url: row.url,
		verification: verificationReading(row.verificationStatus),
	};
}
