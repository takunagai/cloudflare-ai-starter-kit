import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BINDINGS = env as unknown as {
  TEST_MIGRATIONS: D1Migration[];
  PROBE_MIGRATION_DB: D1Database;
  PROBE_UPGRADE_DB: D1Database;
  PROBE_FAILURE_DB: D1Database;
};
describe("工程E isolated migration", () => {
  it("empty schema and reapplication never register an execution window or restore credits", async () => {
    const database = BINDINGS.PROBE_MIGRATION_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    const before = await database
      .prepare("SELECT * FROM d1_migrations ORDER BY id")
      .all();
    expect(before.results).toHaveLength(14);
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_probe_run")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_probe_slots")
        .first(),
    ).toEqual({ n: 0 });
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(
      (await database.prepare("SELECT * FROM d1_migrations ORDER BY id").all())
        .results,
    ).toEqual(before.results);
  });
  it("upgrade retains legacy consumption, unknown rows and existing recovery block", async () => {
    const database = BINDINGS.PROBE_UPGRADE_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 10));
    await database
      .prepare(
        "INSERT INTO image_jobs(id,owner_id,request_key,input_hash,model,state,created_at,updated_at) VALUES('TEST_ONLY_probe_legacy','TEST_ONLY_owner','TEST_ONLY_old_request','TEST_ONLY_hash','fal-ai/flux/schnell','submission_unknown',1,1)",
      )
      .run();
    await database
      .prepare(
        "INSERT INTO ai_verification VALUES(1,'TEST_ONLY_owner',0,1800000,2)",
      )
      .run();
    await database
      .prepare("UPDATE media_runtime_state SET is_recovery_blocked=1")
      .run();
    const before = await database.prepare("SELECT * FROM image_jobs").all();
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(
      (await database.prepare("SELECT * FROM image_jobs").all()).results,
    ).toEqual(before.results);
    expect(
      await database.prepare("SELECT attempts FROM ai_verification").first(),
    ).toEqual({ attempts: 2 });
    expect(
      await database
        .prepare("SELECT is_recovery_blocked FROM media_runtime_state")
        .first(),
    ).toEqual({ is_recovery_blocked: 1 });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_probe_run")
        .first(),
    ).toEqual({ n: 0 });
  });
  it("a failing extension rolls back new DDL without deleting older rows", async () => {
    const database = BINDINGS.PROBE_FAILURE_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 10));
    const migration = BINDINGS.TEST_MIGRATIONS[10];
    await expect(
      applyD1Migrations(database, [
        {
          ...migration,
          queries: [
            ...migration.queries,
            "INSERT INTO TEST_ONLY_nonexistent_table VALUES(1)",
          ],
        },
      ]),
    ).rejects.toThrow();
    expect(
      await database
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name='media_probe_run'",
        )
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: 10 });
    await applyD1Migrations(database, [migration]);
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: 11 });
  });
});
