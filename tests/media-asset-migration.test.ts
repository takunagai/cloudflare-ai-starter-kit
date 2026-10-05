import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BINDINGS = env as unknown as {
  TEST_MIGRATIONS: D1Migration[];
  MEDIA_ASSET_UPGRADE_DB: D1Database;
  MEDIA_ASSET_FAILURE_DB: D1Database;
};
async function setup(database: D1Database) {
  await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 8));
  await database
    .prepare(
      "INSERT INTO media_assets(id,owner_id,object_key,version,source,format,bytes,width,height,state,validated_at,expires_at) VALUES('TEST_ONLY_asset','TEST_ONLY_owner','TEST_ONLY_key',1,'upload','png',1024,32,32,'ready',1,9999999999999)",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO media_jobs(id,owner_id,request_key,request_uuid,input_hash,model_id,catalog_version,kind,quantity,reserved_bytes,provider_state,next_poll_at,monitor_until,created_at,updated_at) VALUES('TEST_ONLY_job','TEST_ONLY_owner','2026-10-04:11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',?,'openai/gpt-image-2.5/sunburst/edit','media-v1','image',1,20971520,'reserved',1,9999999999999,1,1)",
    )
    .bind("a".repeat(64))
    .run();
  await database
    .prepare(
      "INSERT INTO media_job_assets VALUES('TEST_ONLY_job','TEST_ONLY_asset','TEST_ONLY_owner','reference',0,1,NULL)",
    )
    .run();
  return (
    await database.batch([
      database.prepare("SELECT * FROM media_jobs"),
      database.prepare("SELECT * FROM media_assets"),
      database.prepare("SELECT * FROM media_job_assets"),
      database.prepare("SELECT * FROM media_storage_holds"),
      database.prepare("SELECT * FROM media_usage_events"),
    ])
  ).map((result) => result.results);
}
describe("M-2 additive0009 isolated upgrade", () => {
  it("preserves all M-1 jobs/references/capacity/usage through upgrade and repeated application", async () => {
    const database = BINDINGS.MEDIA_ASSET_UPGRADE_DB,
      before = await setup(database);
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    const after = (
      await database.batch([
        database.prepare("SELECT * FROM media_jobs"),
        database.prepare("SELECT * FROM media_assets"),
        database.prepare("SELECT * FROM media_job_assets"),
        database.prepare("SELECT * FROM media_storage_holds"),
        database.prepare("SELECT * FROM media_usage_events"),
      ])
    ).map((result) => result.results);
    expect(after).toEqual(before);
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: BINDINGS.TEST_MIGRATIONS.length });
    await expect(
      database
        .prepare(
          "INSERT INTO media_asset_grants(id,token_hash,job_id,asset_id,owner_id,asset_version,role,ordinal,purpose,expires_at) VALUES('TEST_ONLY_grant',?,'TEST_ONLY_job','TEST_ONLY_asset','TEST_ONLY_other',1,'reference',0,'fal-reference',1000)",
        )
        .bind("a".repeat(64))
        .run(),
    ).rejects.toThrow();
  });
  it("rolls back failing0009 including DDL and preserves0008 capacity views", async () => {
    const database = BINDINGS.MEDIA_ASSET_FAILURE_DB,
      before = await setup(database),
      migration = BINDINGS.TEST_MIGRATIONS[8];
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
      await database
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name='media_uploads'",
        )
        .first(),
    ).toEqual({ n: 0 });
    expect(
      (await database.prepare("SELECT * FROM media_storage_holds").all())
        .results,
    ).toEqual(before[3]);
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: 8 });
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
  });
});
