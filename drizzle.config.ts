import type { Config } from "drizzle-kit";

export default {
  schema: "./src/repository/impl/schema/index.ts",
  out: "./src/repository/impl/schema/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["DB_PATH"] ?? "./foundry.db",
  },
} satisfies Config;
