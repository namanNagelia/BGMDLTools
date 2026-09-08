import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// .env.local wins in development so a local Postgres can be used without
// touching .env, which holds the production Railway connection string.
dotenv.config({ path: ".env.local", override: true });
dotenv.config();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
