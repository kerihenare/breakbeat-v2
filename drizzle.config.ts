import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dbCredentials: {
		url:
			process.env.DATABASE_URL ??
			"postgres://breakbeat:breakbeat@localhost:5432/breakbeat",
	},
	dialect: "postgresql",
	out: "./drizzle",
	schema: "./src/infrastructure/persistence/schema.ts",
	strict: true,
	verbose: true,
});
