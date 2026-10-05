import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MEDIA_CATALOG } from "../src/server/media/catalog";

const BINDINGS = env as unknown as {
  TEST_MIGRATIONS: D1Migration[];
  MEDIA_MIGRATION_DB: D1Database;
  MEDIA_UPGRADE_DB: D1Database;
  MEDIA_FAILURE_DB: D1Database;
};
const legacy = (database: D1Database) =>
  database
    .prepare(
      "INSERT INTO image_jobs(id,owner_id,request_key,input_hash,model,state,created_at,updated_at) VALUES('TEST_ONLY_legacy','TEST_ONLY_owner','TEST_ONLY_request','TEST_ONLY_hash','fal-ai/flux/schnell','submission_unknown',1,1)",
    )
    .run();
describe("M-1 isolated migration compatibility", () => {
  it("applies all migrations on empty D1, reapply adds zero and enforces owner foreign keys", async () => {
    const database = BINDINGS.MEDIA_MIGRATION_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    const before = await database
      .prepare("SELECT * FROM d1_migrations ORDER BY id")
      .all();
    expect(before.results).toHaveLength(BINDINGS.TEST_MIGRATIONS.length);
    const models = await database
      .prepare("SELECT id,kind FROM media_models ORDER BY id")
      .all();
    expect(models.results).toEqual(
      MEDIA_CATALOG.map(({ id, kind }) => ({ id, kind })).sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    );
    await database.prepare("DELETE FROM media_runtime_state").run();
    await expect(legacy(database)).rejects.toThrow("MEDIA_RECOVERY_BLOCKED");
    await database.prepare("INSERT INTO media_runtime_state VALUES(1,0)").run();
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(
      (await database.prepare("SELECT * FROM d1_migrations ORDER BY id").all())
        .results,
    ).toEqual(before.results);
    await expect(
      database
        .prepare(
          "INSERT INTO media_job_bodies VALUES('missing','TEST_ONLY_owner','{}')",
        )
        .run(),
    ).rejects.toThrow();
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM media_job_bodies")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it("upgrades0007 preserving legacy, verification consumption and Jev unknown; old SQL still works", async () => {
    const database = BINDINGS.MEDIA_UPGRADE_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 7));
    await legacy(database);
    await database
      .prepare(
        "INSERT INTO ai_verification VALUES(1,'TEST_ONLY_owner',0,1800000,2)",
      )
      .run();
    await database
      .prepare(`INSERT INTO decision_requests(owner_id,request_key,request_day,definition_id,contract_version,model_id,question_count,state,error_code,attempt_count,created_at,reservation_until,sent_at,execution_until)
      VALUES('TEST_ONLY_owner','2026-10-04:11111111-1111-4111-8111-111111111111','2026-10-04','starter-intent','starter-intent-v1','jev-1.13.0',1,'submission_unknown','decision_submission_unknown',1,0,30000,1,30001)`)
      .run();
    const image = await database.prepare("SELECT * FROM image_jobs").first();
    const decision = await database
      .prepare("SELECT * FROM decision_requests")
      .first();
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(await database.prepare("SELECT * FROM image_jobs").first()).toEqual(
      image,
    );
    expect(
      await database.prepare("SELECT * FROM decision_requests").first(),
    ).toEqual(decision);
    expect(
      await database.prepare("SELECT attempts FROM ai_verification").first(),
    ).toEqual({ attempts: 2 });
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM media_active_jobs")
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (
        await database
          .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
          .first<{ n: number }>()
      )?.n,
    ).toBe(20 * 1024 * 1024);
    await database
      .prepare(
        "UPDATE image_jobs SET state='failed',updated_at=2 WHERE id='TEST_ONLY_legacy'",
      )
      .run();
    await database
      .prepare(
        "INSERT INTO image_jobs(id,owner_id,request_key,input_hash,model,state,created_at,updated_at) VALUES('TEST_ONLY_new_legacy','TEST_ONLY_owner','TEST_ONLY_new_request','hash','fal-ai/flux/schnell','submitting',3,3)",
      )
      .run();
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM image_jobs")
          .first<{ n: number }>()
      )?.n,
    ).toBe(2);
  });
  it("rolls back a failing migration including DDL and leaves old rows intact", async () => {
    const database = BINDINGS.MEDIA_FAILURE_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 7));
    await legacy(database);
    const migration = BINDINGS.TEST_MIGRATIONS[7];
    await expect(
      applyD1Migrations(database, [
        {
          ...migration,
          queries: [
            ...migration.queries,
            "INSERT INTO TEST_ONLY_missing VALUES(1)",
          ],
        },
      ]),
    ).rejects.toThrow();
    expect(
      (
        await database
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE name='media_jobs'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM d1_migrations")
          .first<{ n: number }>()
      )?.n,
    ).toBe(7);
    expect(
      await database.prepare("SELECT state FROM image_jobs").first(),
    ).toEqual({ state: "submission_unknown" });
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM d1_migrations")
          .first<{ n: number }>()
      )?.n,
    ).toBe(BINDINGS.TEST_MIGRATIONS.length);
  });
});
