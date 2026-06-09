import "reflect-metadata";
import { join, relative } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import nunjucks from "nunjucks";
import { AppWebModule } from "./app-web.module";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
	const env = loadEnv();
	const app = await NestFactory.create<NestExpressApplication>(AppWebModule);

	const viewsDir = join(process.cwd(), "src", "interface", "web", "views");
	const njk = nunjucks.configure(viewsDir, {
		autoescape: true,
		noCache: env.NODE_ENV !== "production",
		watch: false,
	});
	const express = app.getHttpAdapter().getInstance();
	express.engine(
		"njk",
		(
			filePath: string,
			ctx: object,
			cb: (e: Error | null, rendered?: string) => void,
		) => {
			try {
				cb(null, njk.render(relative(viewsDir, filePath), ctx));
			} catch (error) {
				cb(error as Error);
			}
		},
	);
	app.setViewEngine("njk");
	app.setBaseViewsDir(viewsDir);
	app.useStaticAssets(join(process.cwd(), "public"), { prefix: "/static" });

	app.enableShutdownHooks();
	await app.listen(env.PORT);
	// eslint-disable-next-line no-console
	console.log(`breakbeat-web listening on http://localhost:${env.PORT}`);
}

void bootstrap();
