/** The read-model the heuristics + Collapse consume — exactly the Result fields Filter needs. */
export type FilterResult = {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly snippet: string;
	readonly publishedDate: string | null; // ISO yyyy-mm-dd, or null
};
