/** The lowercased host of a Result URL, no port. Degrades a non-URL to "" rather than throwing. */
export function resultHost(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return "";
	}
}

// Known multi-part public suffixes — seed list; a full PSL eTLD+1 is a deferred refinement.
const MULTI_PART_SUFFIXES = new Set([
	"co.uk",
	"org.uk",
	"com.au",
	"net.au",
	"org.au",
	"co.nz",
	"co.za",
	"com.br",
	"co.jp",
	"co.in",
	"com.sg",
	"com.mx",
]);

/**
 * Registrable form (eTLD+1) so a subdomain matches its parent (blog.getaglow.co → getaglow.co).
 * Last two labels, or three when the host ends in a known multi-part suffix.
 */
export function registrableDomain(host: string): string {
	const h = host
		.toLowerCase()
		.replace(/^www\./, "")
		.replace(/\.$/, "");
	const labels = h.split(".").filter(Boolean);
	if (labels.length <= 2) return labels.join(".");
	const lastTwo = labels.slice(-2).join(".");
	if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
	return lastTwo;
}
