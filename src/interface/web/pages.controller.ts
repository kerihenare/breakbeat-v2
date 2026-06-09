import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import {
	JOBS_LIST_READ_MODEL,
	type JobsListReadModel,
} from "../../application/ports/read-models.port";
import { buildSearchesLocals } from "./searches.presenter";

const PAGE_SIZE = 20;

@Controller()
export class PagesController {
	constructor(
		@Inject(JOBS_LIST_READ_MODEL) private readonly jobsList: JobsListReadModel,
	) {}

	/** Homepage — the centred search form. */
	@Get()
	home(@Res() res: Response): void {
		res.render("home", { query: "" });
	}

	/** Results list — the searches, most-recent first. */
	@Get("searches")
	async searches(
		@Query("page") pageParam: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		const page = Number(pageParam) || 1;
		const { items, total } = await this.jobsList.list(page, PAGE_SIZE);
		res.render("searches", buildSearchesLocals(items, total, page));
	}
}
