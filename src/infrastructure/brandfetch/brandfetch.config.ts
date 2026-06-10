export type BrandfetchConfig = {
	apiKey: string;
	baseUrl: string;
	timeoutMs: number;
};

export const BRANDFETCH_CONFIG = Symbol("BrandfetchConfig");
