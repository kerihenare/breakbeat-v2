import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppWorkerModule } from "./app-worker.module";

async function bootstrap(): Promise<void> {
	// No HTTP surface — the BullMQ consumer (JobWorkerService) keeps the process
	// alive; enableShutdownHooks drives the drain-worker → close ordering.
	const app = await NestFactory.createApplicationContext(AppWorkerModule);
	app.enableShutdownHooks();
	// eslint-disable-next-line no-console
	console.log("breakbeat-worker started; consuming the pipeline queue");
}

void bootstrap();
