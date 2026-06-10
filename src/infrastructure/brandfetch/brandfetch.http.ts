import type { BrandfetchConfig } from "./brandfetch.config";

/**
 * Shared GET-with-timeout + Bearer auth over global fetch. Translates every
 * transport failure (non-2xx, network error, timeout) into `null` so callers
 * branch on values, never exceptions — degraded paths become Warnings, never Job
 * failures.
 */
export class BrandfetchHttp {
	constructor(private readonly config: BrandfetchConfig) {}

	async getJson(path: string): Promise<unknown | null> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
		try {
			const res = await fetch(`${this.config.baseUrl}${path}`, {
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				method: "GET",
				signal: controller.signal,
			});
			if (!res.ok) return null;
			return (await res.json()) as unknown;
		} catch {
			// network error or AbortError (timeout) — degraded-path signal.
			return null;
		} finally {
			clearTimeout(timer);
		}
	}
}
