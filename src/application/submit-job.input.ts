import { z } from "zod";
import {
	type CompanyAnchor,
	disambiguatedAnchor,
	nameOnlyAnchor,
} from "../domain/job/company-anchor";

/**
 * Validates raw submit input and maps it to a frozen CompanyAnchor.
 *
 * PRD 1 only constructs the anchor from whatever the input already carries; the
 * disambiguation *interaction* (autocomplete, Brand Search options, homepage
 * fetch) is PRD 2. Three shapes:
 *  - a picked brand/domain → `disambiguated` (provenance `picked`)
 *  - a pasted URL / bare domain → `disambiguated` (provenance `url_provided`)
 *  - a bare name with nothing resolvable → `name_only`
 *
 * Blank/garbage is rejected.
 */
export const submitJobInputSchema = z
	.object({
		brandId: z.string().trim().min(1).optional(),
		domain: z.string().trim().min(1).optional(),
		query: z.string().trim().min(1).max(2048).optional(),
	})
	.refine((d) => Boolean(d.query) || Boolean(d.domain) || Boolean(d.brandId), {
		message: "Provide a company name, domain, or brand",
	});

export type SubmitJobInput = z.infer<typeof submitJobInputSchema>;

export function toCompanyAnchor(input: SubmitJobInput): CompanyAnchor {
	// A picked selection carries an explicit domain/brandId.
	if (input.domain || input.brandId) {
		return disambiguatedAnchor({
			brandId: input.brandId ?? null,
			domain: input.domain ?? null,
			provenance: "picked",
		});
	}
	// Otherwise the single query field: a URL/domain becomes a disambiguated
	// anchor (url_provided); anything else is the degraded name-only fallback.
	const query = (input.query ?? "").trim();
	const host = extractHost(query);
	if (host) {
		return disambiguatedAnchor({ domain: host, provenance: "url_provided" });
	}
	return nameOnlyAnchor(query);
}

/** Extract a hostname from a pasted URL or a bare domain; null for a name. */
function extractHost(raw: string): string | null {
	if (raw.includes("://")) {
		try {
			const host = new URL(raw).hostname.replace(/^www\./i, "");
			return host.length > 0 ? host.toLowerCase() : null;
		} catch {
			return null;
		}
	}
	// Bare domain heuristic: dotted, no whitespace, label.label(.label)…
	if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(raw)) {
		return raw.replace(/^www\./i, "").toLowerCase();
	}
	return null;
}
