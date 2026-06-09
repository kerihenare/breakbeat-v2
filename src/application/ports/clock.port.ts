/** Injected so the domain and use-cases are deterministic under test. */
export interface Clock {
	now(): Date;
}

export const CLOCK = Symbol("Clock");
