import type { ResolvedIdentity } from "../resolve/resolved-identity";
import type { FilterResult } from "./filter-result";
import { accountKey } from "./host-knowledge";
import { registrableDomain, resultHost } from "./result-host";

/**
 * True iff the Result sits on a surface the company CONTROLS: one of its own domains (registrable
 * match, subdomains included) OR its named account on a recognised platform (by value-equal
 * account key). Authorship is NOT control — a press release, a guest post, or a third party's
 * post mentioning the company all fail both arms and stay in scope.
 */
export function isOwnChannel(
	result: FilterResult,
	identity: ResolvedIdentity,
): boolean {
	const host = resultHost(result.url);
	if (host !== "") {
		const rd = registrableDomain(host);
		if (identity.ownDomains.some((d) => registrableDomain(d.domain) === rd))
			return true;
	}

	const key = accountKey(result.url);
	if (key !== null) {
		return identity.socialHandles.some((h) => {
			const hk = accountKey(h.url);
			return hk !== null && hk.platform === key.platform && hk.id === key.id;
		});
	}
	return false;
}
