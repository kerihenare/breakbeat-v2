import type { SocialHandle } from "../../domain/resolve/social-handle";

const PLATFORMS: { platform: string; pattern: RegExp }[] = [
	{
		pattern: /linkedin\.com\/(?:company|in)\/([A-Za-z0-9._-]+)/i,
		platform: "linkedin",
	},
	{ pattern: /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i, platform: "x" },
	{ pattern: /([A-Za-z0-9-]+)\.substack\.com/i, platform: "substack" },
	{ pattern: /instagram\.com\/([A-Za-z0-9._]+)/i, platform: "instagram" },
	{ pattern: /facebook\.com\/([A-Za-z0-9.]+)/i, platform: "facebook" },
	{
		pattern: /youtube\.com\/(?:@|c\/|channel\/)?([A-Za-z0-9._-]+)/i,
		platform: "youtube",
	},
];

/** Pure: extracts named social accounts from anchor hrefs. No network, no DOM library. */
export function scrapeHandles(html: string): SocialHandle[] {
	const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map(
		(m) => m[1],
	);
	const seen = new Set<string>();
	const handles: SocialHandle[] = [];
	for (const url of hrefs) {
		for (const { platform, pattern } of PLATFORMS) {
			const match = url.match(pattern);
			if (!match) continue;
			const handle = match[1];
			const key = `${platform}:${handle.toLowerCase()}`;
			if (seen.has(key)) break;
			seen.add(key);
			handles.push({ handle, platform, url });
			break;
		}
	}
	return handles;
}
