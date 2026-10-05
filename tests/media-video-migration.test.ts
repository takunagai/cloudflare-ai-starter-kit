import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BINDINGS = env as unknown as {
  TEST_MIGRATIONS: D1Migration[];
  MEDIA_VIDEO_UPGRADE_DB: D1Database;
  MEDIA_VIDEO_FAILURE_DB: D1Database;
};
async function snapshot(database: D1Database) {
  return (
    await database.batch(
      [
        "media_jobs",
        "media_assets",
        "media_job_assets",
        "media_storage_holds",
        "media_usage_events",
        "media_asset_grants",
      ].map((table) => database.prepare(`SELECT * FROM ${table}`)),
    )
  ).map((result) => result.results);
}
async function setup(database: D1Database) {
  await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 9));
  await database
    .prepare(
      "INSERT INTO media_assets(id,owner_id,object_key,version,source,format,bytes,width,height,state,validated_at,expires_at) VALUES('TEST_ONLY_asset','TEST_ONLY_owner','TEST_ONLY_key',2,'upload','png',1024,1024,1024,'ready',1,9999999999999)",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO media_jobs(id,owner_id,request_key,request_uuid,input_hash,model_id,catalog_version,kind,quantity,reserved_bytes,provider_state,attempt_count,next_poll_at,monitor_until,created_at,updated_at) VALUES('TEST_ONLY_job','TEST_ONLY_owner','2026-10-04:11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111',?,'openai/gpt-image-2.5/sunburst/edit','media-v1','image',1,20971520,'submission_unknown',1,1,9999999999999,1,1)",
    )
    .bind("a".repeat(64))
    .run();
  await database
    .prepare(
      "INSERT INTO media_job_assets VALUES('TEST_ONLY_job','TEST_ONLY_asset','TEST_ONLY_owner','reference',0,2,NULL)",
    )
    .run();
  await database
    .prepare(
      "INSERT INTO media_asset_grants(id,token_hash,job_id,asset_id,owner_id,asset_version,role,ordinal,purpose,expires_at,get_count,head_count,transferred_bytes) VALUES('TEST_ONLY_grant',?,'TEST_ONLY_job','TEST_ONLY_asset','TEST_ONLY_owner',2,'reference',0,'fal-reference',9999999999999,2,3,2048)",
    )
    .bind("b".repeat(64))
    .run();
  return snapshot(database);
}
describe("M-3 additive0010 preserves0009 grant/unknown/usage/capacity and rollback", () => {
  it("upgrades0009, preserves existing image grants and all counters/version/expiry, adds start/end and owner revocation", async () => {
    const database = BINDINGS.MEDIA_VIDEO_UPGRADE_DB,
      before = await setup(database);
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(await snapshot(database)).toEqual(before);
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: BINDINGS.TEST_MIGRATIONS.length });
    for (const role of ["start", "end"]) {
      await database
        .prepare(
          "INSERT INTO media_asset_grants(id,token_hash,job_id,asset_id,owner_id,asset_version,role,ordinal,purpose,expires_at) VALUES(?,?,'TEST_ONLY_job','TEST_ONLY_asset','TEST_ONLY_owner',2,?,0,'fal-reference',9999999999999)",
        )
        .bind(
          `TEST_ONLY_${role}`,
          role === "start" ? "c".repeat(64) : "d".repeat(64),
          role,
        )
        .run();
    }
    await expect(
      database
        .prepare(
          "INSERT INTO media_asset_grants(id,token_hash,job_id,asset_id,owner_id,asset_version,role,ordinal,purpose,expires_at) VALUES('TEST_ONLY_other',?,'TEST_ONLY_job','TEST_ONLY_asset','TEST_ONLY_other',2,'start',0,'fal-reference',9999999999999)",
        )
        .bind("e".repeat(64))
        .run(),
    ).rejects.toThrow();
    await database
      .prepare(
        "UPDATE media_assets SET state='deleting' WHERE id='TEST_ONLY_asset'",
      )
      .run();
    expect(
      await database
        .prepare(
          "SELECT count(*) AS n FROM media_asset_grants WHERE revoked_at IS NULL",
        )
        .first(),
    ).toEqual({ n: 0 });
  });
  it("failed0010 rolls back table copy/drop and restores existing trigger/index and grant data", async () => {
    const database = BINDINGS.MEDIA_VIDEO_FAILURE_DB,
      before = await setup(database),
      migration = BINDINGS.TEST_MIGRATIONS[9];
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
    expect(await snapshot(database)).toEqual(before);
    expect(
      await database
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name IN ('media_grants_asset_revoked','media_grants_asset')",
        )
        .first(),
    ).toEqual({ n: 2 });
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: 9 });
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS);
    expect(await snapshot(database)).toEqual(before);
  });
});
