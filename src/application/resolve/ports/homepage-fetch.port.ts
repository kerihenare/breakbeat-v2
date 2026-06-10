import type { SocialHandle } from "../../../domain/resolve/social-handle";

export type HomepageFetchResult = {
	confirmedName: string | null;
	handles: SocialHandle[];
};

/** The ONE sanctioned outbound HTTP fetch in Breakbeat. */
export interface HomepageFetchPort {
	// null on fetch failure — never throws.
	fetch(domain: string): Promise<HomepageFetchResult | null>;
}

export const HOMEPAGE_FETCH_PORT = Symbol("HomepageFetchPort");
