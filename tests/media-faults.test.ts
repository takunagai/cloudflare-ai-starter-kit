import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_LIMITS } from "../src/server/media/catalog";
import { maintainMediaRetention } from "../src/server/media/retention";
import {
  advanceMediaJob,
  getMediaJob,
  submitMedia,
} from "../src/server/media/service";
import {
  allowNextMediaPoll,
  MEDIA_DATABASE as database,
  MEDIA_ALICE,
  MEDIA_ENV,
  mediaDriver,
  mediaInput,
  resetMediaDatabase,
  syntheticReference,
} from "./media-fixtures";

beforeEach(resetMediaDatabase);
function faultDatabase(
  match: string,
  effect: (statement: D1PreparedStatement) => Promise<D1Result>,
): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare")
        return (sql: string) => {
          const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
            new Proxy(statement, {
              get(value, key) {
                if (key === "bind")
                  return (...bindings: unknown[]) =>
                    wrap(value.bind(...bindings));
                if (key === "run" && sql.includes(match))
                  return () => effect(value);
                const member = Reflect.get(value, key);
                return typeof member === "function"
                  ? member.bind(value)
                  : member;
              },
            });
          return wrap(target.prepare(sql));
        };
      const member = Reflect.get(target, property);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}
describe("M-1 uncertain database stages and reference races", () => {
  it.each([false, true])(
    "claim response failure before/after write %# never dispatches",
    async (isAfterWrite) => {
      const driver = mediaDriver();
      const request = mediaInput();
      const config = {
        ...MEDIA_ENV,
        DB: faultDatabase(
          "SET provider_state='submitting'",
          async (statement) => {
            if (isAfterWrite) await statement.run();
            throw new Error("TEST_ONLY_claim_fault");
          },
        ),
      };
      await expect(
        submitMedia({ env: config, identity: MEDIA_ALICE, driver }, request),
      ).rejects.toMatchObject({ code: "media_ledger_unavailable" });
      const row = await database
        .prepare("SELECT id,provider_state FROM media_jobs")
        .first<{ id: string; provider_state: string }>();
      expect(row?.provider_state).toBe(
        isAfterWrite ? "submitting" : "reserved",
      );
      expect(driver.submit).not.toHaveBeenCalled();
      await maintainMediaRetention(database, Date.now() + 30001);
      expect(
        (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, row?.id ?? ""))
          .providerState,
      ).toBe(isAfterWrite ? "submission_unknown" : "failed");
      expect(
        await database
          .prepare("SELECT count(*) AS n FROM media_usage_events")
          .first(),
      ).toEqual({ n: 1 });
    },
  );
  it.each([false, true])(
    "acknowledgement storage fails before/after write %# without replaying paid submit",
    async (isAfterWrite) => {
      const driver = mediaDriver();
      const request = mediaInput();
      const config = {
        ...MEDIA_ENV,
        DB: faultDatabase("SET provider_id=?", async (statement) => {
          if (isAfterWrite) await statement.run();
          throw new Error("TEST_ONLY_ack_fault");
        }),
      };
      await expect(
        submitMedia({ env: config, identity: MEDIA_ALICE, driver }, request),
      ).rejects.toMatchObject({ code: "media_ledger_unavailable" });
      expect(
        (
          await submitMedia(
            { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
            request,
          )
        ).providerState,
      ).toBe(isAfterWrite ? "queued" : "submission_unknown");
      expect(driver.submit).toHaveBeenCalledTimes(1);
      expect(
        await database
          .prepare("SELECT held_bytes FROM media_storage_reservations")
          .first(),
      ).toEqual({ held_bytes: MEDIA_LIMITS.imageBytes });
    },
  );
  it("atomic reservation failure leaves no body/usage/storage and sends nothing", async () => {
    const driver = mediaDriver();
    const failed = new Proxy(database, {
      get(target, property) {
        if (property === "batch")
          return async () => {
            throw new Error("TEST_ONLY_batch_fault");
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      submitMedia(
        { env: { ...MEDIA_ENV, DB: failed }, identity: MEDIA_ALICE, driver },
        mediaInput(),
      ),
    ).rejects.toMatchObject({ code: "media_ledger_unavailable" });
    for (const table of [
      "media_jobs",
      "media_job_bodies",
      "media_usage_events",
      "media_storage_reservations",
    ])
      expect(
        await database.prepare(`SELECT count(*) AS n FROM ${table}`).first(),
      ).toEqual({ n: 0 });
    expect(driver.submit).not.toHaveBeenCalled();
  });
  it("reference version race makes the whole reservation fail without quota or external side effects", async () => {
    const reference = await syntheticReference(MEDIA_ALICE.id);
    const original = database.batch.bind(database);
    const driver = mediaDriver();
    const spy = vi
      .spyOn(database, "batch")
      .mockImplementationOnce(async (statements) => {
        await database
          .prepare("UPDATE media_assets SET version=2 WHERE id=?")
          .bind(reference)
          .run();
        return original(statements);
      });
    try {
      await expect(
        submitMedia(
          { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
          mediaInput(1, { prompt: "x", references: [reference] }),
        ),
      ).rejects.toMatchObject({ code: "media_reservation_conflict" });
    } finally {
      spy.mockRestore();
    }
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 0 });
    expect(driver.submit).not.toHaveBeenCalled();
  });
  it("reference deletion after claim prevents dispatch and consumes once", async () => {
    const reference = await syntheticReference(MEDIA_ALICE.id);
    const driver = mediaDriver();
    const config = {
      ...MEDIA_ENV,
      DB: faultDatabase(
        "SET provider_state='submitting'",
        async (statement) => {
          const result = await statement.run();
          await database
            .prepare("UPDATE media_assets SET state='deleting' WHERE id=?")
            .bind(reference)
            .run();
          return result;
        },
      ),
    };
    await expect(
      submitMedia(
        { env: config, identity: MEDIA_ALICE, driver },
        mediaInput(1, { prompt: "x", references: [reference] }),
      ),
    ).rejects.toMatchObject({ code: "media_reference_unavailable" });
    expect(driver.submit).not.toHaveBeenCalled();
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
  });
  it.each([false, true])(
    "final storage transaction fails before/after commit %# without fake200",
    async (isAfterWrite) => {
      const driver = mediaDriver();
      const job = await submitMedia(
        { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
        mediaInput(),
      );
      const original = database.batch.bind(database);
      let batches = 0;
      const faulty = new Proxy(database, {
        get(target, property) {
          if (property === "batch")
            return async (statements: D1PreparedStatement[]) => {
              batches++;
              if (batches === 2) {
                if (isAfterWrite) await original(statements);
                throw new Error("TEST_ONLY_final_fault");
              }
              return original(statements);
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      await allowNextMediaPoll(job.id);
      await expect(
        advanceMediaJob(
          { env: { ...MEDIA_ENV, DB: faulty }, identity: MEDIA_ALICE, driver },
          job.id,
        ),
      ).rejects.toMatchObject({ code: "media_ledger_unavailable" });
      expect(
        (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).terminalOutcome,
      ).toBe(isAfterWrite ? "stored" : null);
      expect(driver.submit).toHaveBeenCalledTimes(1);
    },
  );
});
