import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { renderD1Wire } from "../scripts/d1-wire";

const BINDINGS = env as unknown as {
  TEST_MIGRATIONS: D1Migration[];
  HISTORY_MIGRATION_DB: D1Database;
  HISTORY_UPGRADE_DB: D1Database;
  HISTORY_FAILURE_DB: D1Database;
};
const WIRE_MIGRATIONS = BINDINGS.TEST_MIGRATIONS.map((migration) => ({
  ...migration,
  queries: migration.queries.map(renderD1Wire),
}));

describe("D1 SQL wire compatibility", () => {
  it("preserves quoted values and identifiers while grouping nested CASE expressions", () => {
    const sql = `-- CASE END\nSELECT CASE WHEN 1 THEN CASE WHEN 1 THEN '-- CASE END' ELSE 'it''s END' END ELSE "CASE" END;`;
    expect(renderD1Wire(sql)).toBe(
      `SELECT ( CASE WHEN 1 THEN ( CASE WHEN 1 THEN '-- CASE END' ELSE 'it''s END' END ) ELSE "CASE" END ) ;\n`,
    );
    expect(() => renderD1Wire("SELECT CASE WHEN 1 THEN 1;")).toThrow(
      "d1_wire_case_unbalanced",
    );
    expect(renderD1Wire("SELECT 21600,1.25>=1.2,0xAB,10<<2;")).toBe(
      "SELECT 21600 , 1.25 >= 1.2 , 0xAB , 10 << 2 ;\n",
    );
  });

  it("preserves schema, recovery denial, legacy unknown capacity and the probe table drop", async () => {
    const original = BINDINGS.HISTORY_MIGRATION_DB;
    const wire = BINDINGS.HISTORY_UPGRADE_DB;
    await applyD1Migrations(original, BINDINGS.TEST_MIGRATIONS);
    await applyD1Migrations(wire, WIRE_MIGRATIONS);
    const schema = (database: D1Database) =>
      database
        .prepare(
          "SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
    expect((await schema(wire)).results).toEqual(
      (await schema(original)).results,
    );
    for (const database of [original, wire]) {
      expect(
        await database
          .prepare("SELECT count(*) AS n FROM d1_migrations")
          .first(),
      ).toEqual({ n: 15 });
      expect(
        await database
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'media_probe%'",
          )
          .first(),
      ).toEqual({ n: 0 });
      await database
        .prepare("UPDATE media_runtime_state SET is_recovery_blocked=1")
        .run();
      const legacy = database.prepare(
        "INSERT INTO image_jobs(id,owner_id,request_key,input_hash,model,state,created_at,updated_at) VALUES('TEST_ONLY_wire_legacy','TEST_ONLY_owner','TEST_ONLY_request','TEST_ONLY_hash','fal-ai/flux/schnell','submission_unknown',1,1)",
      );
      await expect(legacy.run()).rejects.toThrow("MEDIA_RECOVERY_BLOCKED");
      await database
        .prepare("UPDATE media_runtime_state SET is_recovery_blocked=0")
        .run();
      await legacy.run();
      await expect(
        database
          .prepare(
            "INSERT INTO image_jobs(id,owner_id,request_key,input_hash,model,state,created_at,updated_at) VALUES('TEST_ONLY_wire_second','TEST_ONLY_owner','TEST_ONLY_second','TEST_ONLY_hash','fal-ai/flux/schnell','submission_unknown',2,2)",
          )
          .run(),
      ).rejects.toThrow("MEDIA_LIMIT_REACHED");
      expect(
        await database.prepare("SELECT state FROM image_jobs").first(),
      ).toEqual({ state: "submission_unknown" });
    }
  });

  it("rolls back failing wire DDL while retaining seven applied files and old rows", async () => {
    const database = BINDINGS.HISTORY_FAILURE_DB;
    await applyD1Migrations(database, BINDINGS.TEST_MIGRATIONS.slice(0, 7));
    await database
      .prepare(
        "INSERT INTO image_jobs(id,owner_id,request_key,input_hash,model,state,created_at,updated_at) VALUES('TEST_ONLY_wire_preserved','TEST_ONLY_owner','TEST_ONLY_request','TEST_ONLY_hash','fal-ai/flux/schnell','submission_unknown',1,1)",
      )
      .run();
    const before = await database.prepare("SELECT * FROM image_jobs").all();
    await expect(
      applyD1Migrations(database, [
        {
          ...WIRE_MIGRATIONS[7],
          queries: [
            ...WIRE_MIGRATIONS[7].queries,
            "INSERT INTO TEST_ONLY_nonexistent_table VALUES(1)",
          ],
        },
      ]),
    ).rejects.toThrow();
    expect(
      await database.prepare("SELECT count(*) AS n FROM d1_migrations").first(),
    ).toEqual({ n: 7 });
    expect(
      await database
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name='media_runtime_state'",
        )
        .first(),
    ).toEqual({ n: 0 });
    expect(
      (await database.prepare("SELECT * FROM image_jobs").all()).results,
    ).toEqual(before.results);
  });
});
