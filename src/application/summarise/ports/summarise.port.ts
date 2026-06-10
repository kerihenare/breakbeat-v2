import type { SummariseInput } from "../../../domain/summarise/summarise-input";
import type { Summary } from "../../../domain/summarise/summary";

/**
 * The one digest call's outcome. The adapter Zod-validates BEFORE returning
 * `ok: true`; a transport / quota / SDK error AND a schema-validation failure
 * both surface as `ok: false` — NEVER a throw.
 */
export type SummariseResult = { ok: true; summary: Summary } | { ok: false };

/** ONE call per Job (the digest is Job-level, never per Result). Never throws — failure is a value. */
export interface SummarisePort {
	summarise(input: SummariseInput): Promise<SummariseResult>;
}

export const SUMMARISE_PORT = Symbol("SummarisePort");
