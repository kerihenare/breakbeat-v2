import { isDistinctive } from "./distinctive-title";
import type { FilterConfig } from "./filter-config";
import { normalizeTitle } from "./normalize-title";

export type CollapseInput = {
	readonly id: string;
	readonly title: string;
	readonly sourceDomain: string;
	readonly publishedDate: string | null; // ISO yyyy-mm-dd, or null
};
export type CollapseLoser = {
	readonly loserId: string;
	readonly winnerId: string;
};

type DatedInput = CollapseInput & { publishedDate: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: string, b: string): number =>
	Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

/**
 * Pure clustering over normalized DISTINCTIVE title + publication date. Dated copies cluster within
 * `collapseWindowDays` of the cluster's EARLIEST member; a cluster collapses only across
 * `minClusterDomains` distinct source domains (the wire-syndication signature); the earliest-published
 * copy wins. An undated copy joins only under a single-cluster key. Bias to under-collapse.
 */
export function collapse(
	inputs: readonly CollapseInput[],
	companyName: string,
	config: FilterConfig,
): CollapseLoser[] {
	// 1. key + distinctiveness gate
	const keyed = inputs
		.map((input) => ({ input, key: normalizeTitle(input.title) }))
		.filter(({ key }) => isDistinctive(key, companyName, config));

	// 2. group by normalized key
	const groups = new Map<string, CollapseInput[]>();
	for (const { input, key } of keyed) {
		const existing = groups.get(key);
		if (existing) existing.push(input);
		else groups.set(key, [input]);
	}

	const losers: CollapseLoser[] = [];

	for (const members of groups.values()) {
		const dated = members
			.filter((m): m is DatedInput => m.publishedDate !== null)
			.sort((a, b) =>
				a.publishedDate === b.publishedDate
					? a.id.localeCompare(b.id)
					: a.publishedDate.localeCompare(b.publishedDate),
			);
		const undated = members.filter((m) => m.publishedDate === null);

		// 3. cluster dated members greedily, anchored to the earliest member of each open cluster
		const clusters: DatedInput[][] = [];
		for (const m of dated) {
			const open = clusters[clusters.length - 1];
			if (
				open &&
				daysBetween(open[0].publishedDate, m.publishedDate) <=
					config.collapseWindowDays
			) {
				open.push(m);
			} else {
				clusters.push([m]);
			}
		}
		if (clusters.length === 0) continue; // all undated → no anchor → stay included

		// 4. undated join only when the key produced exactly one cluster
		const memberships: CollapseInput[][] = clusters.map((c) => [...c]);
		if (clusters.length === 1 && undated.length > 0)
			memberships[0].push(...undated);

		// 5 + 6. collapsibility (>=2 members, dated copies span >= minClusterDomains) → earliest wins
		for (let i = 0; i < clusters.length; i++) {
			const datedDomains = new Set(clusters[i].map((m) => m.sourceDomain));
			const all = memberships[i];
			if (all.length < 2 || datedDomains.size < config.minClusterDomains)
				continue;
			const winnerId = clusters[i][0].id; // earliest-published
			for (const m of all) {
				if (m.id !== winnerId) losers.push({ loserId: m.id, winnerId });
			}
		}
	}

	return losers;
}
