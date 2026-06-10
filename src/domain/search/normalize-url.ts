const TRACKING_PARAMS = [/^utm_/i, /^gclid$/i, /^fbclid$/i, /^ref$/i, /^mc_/i];

/**
 * Produces the value stored in `results.normalized_url` and compared by the
 * `(job_id, normalized_url)` unique constraint — the ONLY dedup mechanism Search
 * owns (near-duplicate title Collapse is Filter's). Lowercases the host, strips
 * scheme/www/default-port/trailing-slash/fragment, drops tracking params, and
 * sorts the surviving query so two forms of one article collapse to one key. A
 * non-URL degrades to its trimmed, lowercased self rather than throwing.
 */
export function normalizeUrl(input: string): string {
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		return input.trim().toLowerCase();
	}

	const host = parsed.host.toLowerCase().replace(/^www\./, "");
	const path = parsed.pathname.replace(/\/+$/, ""); // drop trailing slash(es)

	const params = [...parsed.searchParams.entries()]
		.filter(([key]) => !TRACKING_PARAMS.some((p) => p.test(key)))
		.sort(([a], [b]) => a.localeCompare(b));
	const query = params.length
		? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}`
		: "";

	return `${host}${path}${query}`;
}
