// ── Aggregator / index / directory surfaces (matched against the FULL host, www stripped). ──
export const AGGREGATOR_HOSTS: ReadonlySet<string> = new Set([
	"news.google.com",
	"news.yahoo.com",
	"flipboard.com",
	"paper.li",
	"feedly.com",
	"scoop.it",
	"allsides.com",
	"smartnews.com",
]);

// ── Product / ecommerce / product-review / comparison surfaces (matched against the REGISTRABLE domain). ──
export const ECOMMERCE_REVIEW_HOSTS: ReadonlySet<string> = new Set([
	"amazon.com",
	"amazon.co.uk",
	"amazon.com.au",
	"ebay.com",
	"etsy.com",
	"g2.com",
	"capterra.com",
	"getapp.com",
	"trustpilot.com",
	"productreview.com.au",
]);

/** The account identity of a platform URL — same shape for a Result URL and a scraped handle URL. */
export type AccountKey = { readonly platform: string; readonly id: string };

/**
 * Derives a stable {platform, id} from any URL on a recognised third-party platform — the basis of
 * the Own Channel control-not-authorship test. A non-platform URL → null.
 */
export function accountKey(url: string): AccountKey | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	const host = u.hostname.toLowerCase().replace(/^www\./, "");
	const segs = u.pathname.split("/").filter(Boolean);

	if (host === "linkedin.com" && segs[0] === "company" && segs[1])
		return { id: segs[1].toLowerCase(), platform: "linkedin" };
	if ((host === "x.com" || host === "twitter.com") && segs[0])
		return { id: segs[0].toLowerCase(), platform: "x" };
	if (host === "instagram.com" && segs[0])
		return { id: segs[0].toLowerCase(), platform: "instagram" };
	if (host === "facebook.com" && segs[0])
		return { id: segs[0].toLowerCase(), platform: "facebook" };
	if (host === "tiktok.com" && segs[0]?.startsWith("@"))
		return { id: segs[0].slice(1).toLowerCase(), platform: "tiktok" };
	if (host.endsWith(".substack.com"))
		return {
			id: host.slice(0, -".substack.com".length),
			platform: "substack",
		};
	if (host === "apps.apple.com") {
		const idSeg = segs.find((s) => /^id\d+$/.test(s));
		if (idSeg) return { id: idSeg.toLowerCase(), platform: "appstore" };
	}
	if (host === "play.google.com") {
		const pkg = u.searchParams.get("id");
		if (pkg) return { id: pkg.toLowerCase(), platform: "playstore" };
	}
	return null;
}
