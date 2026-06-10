/**
 * SocialHandle — a social account scraped from the target homepage. `platform`
 * is an open string the scraper sets ("linkedin" | "x" | "substack" | ...).
 */
export type SocialHandle = {
	readonly platform: string;
	readonly handle: string;
	readonly url: string;
};
