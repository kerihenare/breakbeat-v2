import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppWorkerModule } from "./app-worker.module";
import type { Stage } from "./application/pipeline/stage.port";
import { STAGES } from "./application/pipeline/stage.port";
import { TracingStage } from "./infrastructure/observability/tracing-stage";
import { DB_CONNECTION, REDIS_CONNECTION } from "./interface/di-tokens";

// loadEnv() (in coreProviders + BrandfetchModule) parses process.env; provide the
// required backing-service URLs so the graph compiles. DB/Redis connections are
// overridden with fakes so no real socket opens — we only assert the stage list.
const ORIGINAL = { ...process.env };

describe("AppWorkerModule wiring", () => {
	beforeAll(() => {
		process.env.DATABASE_URL ??= "postgres://breakbeat:breakbeat@localhost/x";
		process.env.REDIS_URL ??= "redis://localhost:6379";
	});
	afterAll(() => {
		process.env = ORIGINAL;
	});

	it("registers the five stages in pipeline order, each wrapped in a Stage Span decorator", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppWorkerModule],
		})
			.overrideProvider(DB_CONNECTION)
			.useValue({ client: {}, db: {} })
			.overrideProvider(REDIS_CONNECTION)
			.useValue({})
			.compile();

		const stages = moduleRef.get<Stage[]>(STAGES);
		expect(stages).toHaveLength(5);
		// Each stage is decorated with TracingStage (PRD 8 Stage Span) — the
		// decorator preserves the inner stage's name, which is the pipeline order.
		for (const stage of stages) {
			expect(stage).toBeInstanceOf(TracingStage);
		}
		expect(stages.map((s) => s.name)).toEqual([
			"resolve",
			"search",
			"filter",
			"analyze",
			"summarise",
		]);
	});
});
