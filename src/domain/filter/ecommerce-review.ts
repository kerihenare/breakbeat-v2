import type { FilterResult } from "./filter-result";
import { ECOMMERCE_REVIEW_HOSTS } from "./host-knowledge";
import { registrableDomain, resultHost } from "./result-host";

const PATH_CUES =
	/\/(dp|gp\/product|product|products|shop|store|cart|checkout|reviews?|compare)(\/|$)/i;
const SNIPPET_CUES =
	/\b(add to cart|buy now|in stock|out of stock|free shipping|customer reviews?|star rating)\b/i;

/** A place to buy or rate the product — not coverage about the company. Structural over host/path/snippet. */
export function isEcommerceReview(result: FilterResult): boolean {
	const host = resultHost(result.url);
	if (host !== "" && ECOMMERCE_REVIEW_HOSTS.has(registrableDomain(host)))
		return true;

	let path = "";
	try {
		path = new URL(result.url).pathname;
	} catch {
		path = "";
	}
	if (PATH_CUES.test(path)) return true;

	return SNIPPET_CUES.test(result.snippet);
}
