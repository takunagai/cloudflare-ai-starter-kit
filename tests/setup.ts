import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";
import type { AppEnv } from "../src/server/env";

// Vitest 5ではsetup fileが`cloudflare:test`を実行時にimportすると、同じworkerの
// 2ファイル目でworkerdが終了する（cloudflare/workers-sdk#16331、2026-10-19時点でopen）。
// pluginの`applyD1Migrations`と同じ表・同じ手順で適用し、importは型だけにする。
// 修正版のpluginが出たら`applyD1Migrations`の呼び出しへ戻す。
async function applyMigrations(db: D1Database, migrations: D1Migration[]) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS "d1_migrations" (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
	);`,
    )
    .run();
  const applied = new Set(
    (
      await db.prepare(`SELECT name FROM "d1_migrations";`).all<{
        name: string;
      }>()
    ).results.map(({ name }) => name),
  );
  const insert = db.prepare(`INSERT INTO "d1_migrations" (name) VALUES (?);`);
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.batch([
      ...migration.queries.map((query) => db.prepare(query)),
      insert.bind(migration.name),
    ]);
  }
}

beforeAll(async () => {
  const bindings = env as unknown as AppEnv & {
    TEST_MIGRATIONS: D1Migration[];
  };
  await applyMigrations(bindings.DB, bindings.TEST_MIGRATIONS);
});
