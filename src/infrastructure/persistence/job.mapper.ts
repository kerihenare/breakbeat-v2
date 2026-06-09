import {
	type CompanyAnchor,
	disambiguatedAnchor,
	nameOnlyAnchor,
} from "../../domain/job/company-anchor";
import type { jobs } from "./schema";

type JobRow = typeof jobs.$inferSelect;

/** The frozen anchor → durable columns (written once at submit, never updated). */
export function anchorColumns(anchor: CompanyAnchor) {
	if (anchor.kind === "disambiguated") {
		return {
			anchorBrandId: anchor.brandId,
			anchorDomain: anchor.domain,
			anchorKind: "disambiguated" as const,
			anchorName: null,
			anchorProvenance: anchor.provenance,
		};
	}
	return {
		anchorBrandId: null,
		anchorDomain: null,
		anchorKind: "name_only" as const,
		anchorName: anchor.name,
		anchorProvenance: "name_only" as const,
	};
}

/** A persisted `jobs` row → the frozen anchor value object (re-frozen via the factories). */
export function rowToAnchor(row: JobRow): CompanyAnchor {
	if (row.anchorKind === "name_only") {
		return nameOnlyAnchor(row.anchorName ?? "");
	}
	return disambiguatedAnchor({
		brandId: row.anchorBrandId,
		domain: row.anchorDomain,
		provenance:
			row.anchorProvenance === "url_provided" ? "url_provided" : "picked",
	});
}
