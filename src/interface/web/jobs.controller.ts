import {
	Body,
	Controller,
	Get,
	Inject,
	Param,
	Post,
	Query,
	Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import {
	JOB_REPOSITORY,
	type JobRepository,
} from "../../application/ports/job-repository.port";
import {
	RESULTS_READ_MODEL,
	type ResultsReadModel,
} from "../../application/ports/read-models.port";
import type { SubmitJobUseCase } from "../../application/submit-job.usecase";
import { SUBMIT_JOB } from "../di-tokens";
import { buildResultLocals } from "./result.presenter";

const PAGE_SIZE = 20;

@Controller()
export class JobsController {
	constructor(
		@Inject(SUBMIT_JOB) private readonly submitJob: SubmitJobUseCase,
		@Inject(JOB_REPOSITORY) private readonly jobs: JobRepository,
		@Inject(RESULTS_READ_MODEL) private readonly results: ResultsReadModel,
	) {}

	/** Submit a Job (the enqueue entry point) and navigate to its Result page. */
	@Post("jobs")
	async create(
		@Body() body: Record<string, unknown>,
		@Res() res: Response,
	): Promise<void> {
		const query = typeof body?.query === "string" ? body.query : "";
		try {
			const id = await this.submitJob.execute(body);
			res.redirect(303, `/jobs/${id}`);
		} catch (error) {
			if (error instanceof ZodError) {
				// Bad input — a 400 with a helpful, field-level message.
				res.status(400).render("home", {
					error: "Please enter a company name or domain.",
					query,
				});
				return;
			}
			// An infrastructure failure (e.g. DB/queue down), not the user's input.
			// Surfaced honestly as a 500 rather than mislabelled a validation error.
			console.error("submit-job failed:", error);
			res.status(500).render("home", {
				error: "Something went wrong starting your search. Please try again.",
				query,
			});
		}
	}

	/** The observable Result page — server-rendered page-1 of the current state. */
	@Get("jobs/:id")
	async show(
		@Param("id") id: string,
		@Query("page") pageParam: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		const job = await this.jobs.findById(id);
		if (!job) {
			res.status(404).render("not-found");
			return;
		}
		const page = Number(pageParam) || 1;
		const [included, excluded, counts] = await Promise.all([
			this.results.includedPage(id, page, PAGE_SIZE),
			this.results.excluded(id),
			this.results.countsByContentType(id),
		]);
		res.render(
			"result",
			buildResultLocals(job, included, excluded, counts, page),
		);
	}
}
