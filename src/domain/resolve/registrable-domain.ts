/**
 * Normalizes a domain for *matching* (de-self comparisons): lowercase, strip
 * scheme, leading "www.", port, and path. A full public-suffix-list eTLD+1 is a
 * deferred refinement (see spec) and is not needed to compare an anchor domain
 * against a Brand Search hit.
 */
export function registrableDomain(domain: string | null | undefined): string {
	if (!domain) return "";
	const trimmed = domain.trim().toLowerCase();
	if (trimmed === "") return "";
	const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
	const host = withoutScheme
		.split("/")[0]
		.split("?")[0]
		.split("#")[0]
		.split(":")[0];
	return host.replace(/^www\./, "");
}
