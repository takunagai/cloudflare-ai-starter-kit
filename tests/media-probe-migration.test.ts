import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const BINDINGS = env as unknown as {
  TEST_MIGRATIONS: D1Migration[];
  HISTORY_MIGRATION_DB: D1Database;
  HISTORY_UPGRADE_DB: D1Database;
  HISTORY_FAILURE_DB: D1Database;
};
// 0001〜0012・0014・0015の14本。0016が工程Eのtableを外す。
const BEFORE_DROP = 14;
const probeObjects = (database: D1Database) =>
  database
    .prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'media_probe%'",
    )
    .first();
const seedProbeRun = async (database: D1Database) => {
  await database
    .prepare(
      "INSERT INTO media_probe_run(id,approval_version,owner_id,app_origin,started_at,expires_at) VALUES(1,'e-sunburst-20261005-v1','TEST_ONLY_owner','https://probe.example.test',0,1800000)",
    )
    .run();
  await database
    .prepare(
      `INSERT INTO media_probe_slots VALUES(1,1,'${"r".repeat(47)}','${"h".repeat(64)}')`,
    )
    .run();
};

describe("工程E migrationの履歴と撤去（0011〜0016）", () => {
  it("empty schema ends without probe objects and reapplication is a no-op", async () => {
    const database = BINDINGS.HISTORY_MIGRATION_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    const before = await database
      .prepare("SELECT * FROM d1_migrations ORDER BY id")
      .all();
    expect(before.results).toHaveLength(BEFORE_DROP + 1);
    expect(await probeObjects(database)).toEqual({ n: 0 });
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(
      (await database.prepare("SELECT * FROM d1_migrations ORDER BY id").all())
        .results,
    ).toEqual(before.results);
  });
  it("upgrade drops probe rows while retaining legacy consumption and recovery block", async () => {
    const database = BINDINGS.HISTORY_UPGRADE_DB;
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
    await applyD1Migrations(
      database,
      BINDINGS.TEST_MIGRATIONS.slice(0, BEFORE_DROP),
    );
    await seedProbeRun(database);
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(await probeObjects(database)).toEqual({ n: 0 });
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
  });
  it("a failing drop keeps probe tables and rows until it is reapplied", async () => {
    const database = BINDINGS.HISTORY_FAILURE_DB;
    await applyD1Migrations(
      database,
      BINDINGS.TEST_MIGRATIONS.slice(0, BEFORE_DROP),
    );
    await seedProbeRun(database);
    const migration = BINDINGS.TEST_MIGRATIONS[BEFORE_DROP];
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
        .prepare("SELECT count(*) AS n FROM media_probe_slots")
        .first(),
    ).toEqual({ n: 1 });
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: BEFORE_DROP });
    await applyD1Migrations(database, [migration]);
    expect(await probeObjects(database)).toEqual({ n: 0 });
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: BEFORE_DROP + 1 });
  });
});
