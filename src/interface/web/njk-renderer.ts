import { join } from "node:path";
import nunjucks from "nunjucks";

/**
 * A standalone nunjucks environment over the same views directory the Express
 * view engine uses. The SSE handler renders the results-list and status-badge
 * partials to strings here, so a streamed frame is byte-identical to the
 * server-rendered page (no client-side row-markup duplication, no parity drift).
 */
const env = nunjucks.configure(
	join(process.cwd(), "src", "interface", "web", "views"),
	{ autoescape: true, noCache: process.env.NODE_ENV !== "production" },
);

export function renderResultList(locals: object): string {
	return env.render("_result-list.njk", locals);
}

export function renderStatusBadge(status: object): string {
	return env.render("_status-badge.njk", { status });
}
