import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  MOD_PASSWORD: z.string().min(1),
  MOD_JWT_SECRET: z.string().min(16),
  ALLOWED_ORIGIN: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(4000),
});

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:");
    console.error(z.treeifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
