import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { AppEnv } from "../src/server/env";

beforeAll(async () => {
  const bindings = env as unknown as AppEnv & {
    TEST_MIGRATIONS: D1Migration[];
  };
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
