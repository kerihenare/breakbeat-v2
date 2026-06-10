export type SearchConfig = {
	lowYieldThreshold: number; // distinct broad Results below which escalation fires (~10, Aglow-tuned)
	horizonMonths: number; // 36
	windowMonths: number; // 12
};

export const SEARCH_CONFIG = Symbol("SearchConfig");
