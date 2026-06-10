import type { FilterResult } from "./filter-result";
import { AGGREGATOR_HOSTS } from "./host-knowledge";
import { resultHost } from "./result-host";

const DIR_CUES =
	/\/(topic|tag|tags|category|categories|directory|feed)(\/|$)|[?&]q=/i;

/** A link-aggregator / index / directory that re-lists rather than reporting. Conservative by design. */
export function isAggregator(result: FilterResult): boolean {
	const host = resultHost(result.url);
	if (host !== "" && AGGREGATOR_HOSTS.has(host.replace(/^www\./, "")))
		return true;

	let pathAndQuery = "";
	try {
		const u = new URL(result.url);
		pathAndQuery = u.pathname + u.search;
	} catch {
		pathAndQuery = "";
	}
	return DIR_CUES.test(pathAndQuery);
}
