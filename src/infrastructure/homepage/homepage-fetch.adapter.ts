import type {
	HomepageFetchPort,
	HomepageFetchResult,
} from "../../application/resolve/ports/homepage-fetch.port";
import { scrapeHandles } from "./scrape-handles";

export type HomepageFetchOptions = { timeoutMs: number };

/** The ONE sanctioned outbound HTTP fetch. Confirms the name and scrapes social handles. */
export class HomepageFetchAdapter implements HomepageFetchPort {
	constructor(private readonly options: HomepageFetchOptions) {}

	async fetch(domain: string): Promise<HomepageFetchResult | null> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
		try {
			const res = await fetch(`https://${domain}`, {
				method: "GET",
				signal: controller.signal,
			});
			if (!res.ok) return null;
			const html = await res.text();
			return { confirmedName: extractName(html), handles: scrapeHandles(html) };
		} catch {
			return null;
		} finally {
			clearTimeout(timer);
		}
	}
}

function extractName(html: string): string | null {
	const og = html.match(
		/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
	);
	if (og) return og[1].trim();
	const title = html.match(/<title>([^<]+)<\/title>/i);
	return title ? title[1].trim() : null;
}
