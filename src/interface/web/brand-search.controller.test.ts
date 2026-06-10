import { describe, expect, it, vi } from "vitest";
import type { BrandSearchPort } from "../../application/resolve/ports/brand-search.port";
import type { Env } from "../../config/env";
import { BrandSearchController } from "./brand-search.controller";

const env = (minChars: number) => ({ AUTOCOMPLETE_MIN_CHARS: minChars }) as Env;
const port = (search: BrandSearchPort["search"]): BrandSearchPort => ({
	search,
});

describe("BrandSearchController", () => {
	it("returns [] and never calls the port for a too-short query", async () => {
		const search = vi.fn(async () => []);
		const controller = new BrandSearchController(port(search), env(2));
		expect(await controller.search("a")).toEqual([]);
		expect(search).not.toHaveBeenCalled();
	});

	it("trims the query before the min-chars check", async () => {
		const search = vi.fn(async () => []);
		const controller = new BrandSearchController(port(search), env(2));
		expect(await controller.search("  a  ")).toEqual([]);
		expect(search).not.toHaveBeenCalled();
	});

	it("maps Brand Search hits to {brandId,name,domain} suggestions (no re-ranking)", async () => {
		const search = vi.fn(async () => [
			{ brandId: "b1", domain: "aglow.com", name: "Aglow", relevance: 0.9 },
			{ brandId: null, domain: null, name: "Aglow Beauty", relevance: 0.4 },
		]);
		const controller = new BrandSearchController(port(search), env(2));
		expect(await controller.search("aglow")).toEqual([
			{ brandId: "b1", domain: "aglow.com", name: "Aglow" },
			{ brandId: null, domain: null, name: "Aglow Beauty" },
		]);
		expect(search).toHaveBeenCalledWith("aglow");
	});

	it("returns [] when the port yields nothing (a failure is [] not a throw)", async () => {
		const controller = new BrandSearchController(
			port(async () => []),
			env(2),
		);
		expect(await controller.search("nothing here")).toEqual([]);
	});
});
