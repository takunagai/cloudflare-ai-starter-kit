import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_LIMITS, normalizeMedia } from "../src/server/media/catalog";
import {
  claimMediaSubmission,
  expireMediaSubmissions,
  reserveMedia,
} from "../src/server/media/ledger";
import {
  blockMediaRecovery,
  confirmMediaAssetDeletion,
  eraseMediaBody,
  maintainMediaRetention,
  readMediaRecoveryWitness,
  reconcileMediaRecovery,
} from "../src/server/media/retention";
import {
  advanceMediaJob,
  getMediaJob,
  submitMedia,
} from "../src/server/media/service";
import {
  allowNextMediaPoll,
  MEDIA_DATABASE as database,
  MEDIA_ALICE,
  MEDIA_BOB,
  MEDIA_ENV,
  mediaDriver,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";

beforeEach(resetMediaDatabase);
afterEach(() => vi.restoreAllMocks());
describe("M-1 body erasure, minimal ledger retention and recovery fencing", () => {
  it("deletion of a partial output cancels its active job and never resurrects the asset", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(
      context,
      mediaInput(0, { prompt: "x", count: 2 }),
    );
    driver.collect.mockImplementationOnce(async (row) => ({
      assets: [
        {
          id: crypto.randomUUID(),
          ordinal: 0,
          objectKey: `media/results/${row.id}/0`,
          format: "png",
          bytes: 1024,
          width: 1024,
          height: 1024,
          validatedAt: Date.now(),
        },
      ],
      isComplete: false,
      hasInvalidOutput: false,
    }));
    await allowNextMediaPoll(job.id);
    await advanceMediaJob(context, job.id);
    const asset = (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).assets[0];
    await confirmMediaAssetDeletion(
      database,
      MEDIA_ALICE.id,
      asset.id,
      async () => true,
    );
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 2 * MEDIA_LIMITS.imageBytes });
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "discarded",
      isCancellationRequested: true,
    });
    expect(
      await database
        .prepare("SELECT state FROM media_assets WHERE id=?")
        .bind(asset.id)
        .first(),
    ).toEqual({ state: "deleted" });
    expect(driver.collect).toHaveBeenCalledTimes(1);
    expect(driver.submit).toHaveBeenCalledTimes(1);
  });
  it("erases body at terminal+30 days, keeps minimal usage/hash until90, rejects original ID after purge", async () => {
    const driver = mediaDriver();
    driver.submit.mockResolvedValue({ outcome: "rejected" });
    const request = mediaInput();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    await expect(submitMedia(context, request)).rejects.toMatchObject({
      code: "media_submission_rejected",
    });
    const job = await submitMedia(context, request);
    const terminalAt = job.terminalAt ?? 0;
    await maintainMediaRetention(
      database,
      terminalAt + MEDIA_LIMITS.bodyRetentionMs - 1,
    );
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_job_bodies")
        .first(),
    ).toEqual({ n: 1 });
    await maintainMediaRetention(
      database,
      terminalAt + MEDIA_LIMITS.bodyRetentionMs,
    );
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_job_bodies")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
    expect((await submitMedia(context, request)).bodyAvailable).toBe(false);
    await expect(
      submitMedia(context, { ...request, input: { prompt: "different" } }),
    ).rejects.toMatchObject({ status: 409 });
    await maintainMediaRetention(
      database,
      terminalAt + MEDIA_LIMITS.ledgerRetentionMs - 1,
    );
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 1 });
    const future = terminalAt + MEDIA_LIMITS.ledgerRetentionMs;
    await maintainMediaRetention(database, future);
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 0 });
    vi.spyOn(Date, "now").mockReturnValue(future);
    await expect(submitMedia(context, request)).rejects.toMatchObject({
      code: "media_request_day_mismatch",
    });
    expect(driver.submit).toHaveBeenCalledTimes(1);
  });
  it("erases early while OFF without returning quotas or active slots", async () => {
    const driver = mediaDriver();
    const request = mediaInput();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(context, request);
    const erased = await eraseMediaBody(
      {
        ...MEDIA_ENV,
        ENABLE_MEDIA: "false",
        MEDIA_ALLOWED_MODELS: "[]",
        FAL_KEY: undefined,
      },
      MEDIA_ALICE,
      job.id,
    );
    expect(erased).toMatchObject({
      input: null,
      bodyAvailable: false,
      terminalAt: null,
      isCancellationRequested: true,
    });
    await eraseMediaBody(MEDIA_ENV, MEDIA_ALICE, job.id);
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
    expect((await submitMedia(context, request)).id).toBe(job.id);
    await expect(submitMedia(context, mediaInput())).rejects.toMatchObject({
      status: 429,
    });
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(driver.cancel).not.toHaveBeenCalled();
  });
  it("reserved expiry is provably unsent; claimed expiry is unknown with all holds retained", async () => {
    const normalized = normalizeMedia(mediaInput());
    const now = Date.now();
    const reserved = await reserveMedia(
      database,
      MEDIA_ALICE.id,
      normalized,
      "0".repeat(64),
      [],
      now,
    );
    await expireMediaSubmissions(database, now + 30000);
    expect(
      await database
        .prepare(
          "SELECT provider_state,attempt_count,terminal_outcome FROM media_jobs WHERE id=?",
        )
        .bind(reserved.job.id)
        .first(),
    ).toEqual({
      provider_state: "failed",
      attempt_count: 0,
      terminal_outcome: "failed",
    });
    const second = await reserveMedia(
      database,
      MEDIA_BOB.id,
      normalizeMedia(mediaInput()),
      "1".repeat(64),
      [],
      now,
    );
    await claimMediaSubmission(database, second.job, now);
    await expireMediaSubmissions(database, now + 30000);
    await maintainMediaRetention(database, now + 91 * 86400000);
    expect(
      await database
        .prepare(
          "SELECT provider_state,attempt_count,terminal_at FROM media_jobs WHERE id=?",
        )
        .bind(second.job.id)
        .first(),
    ).toEqual({
      provider_state: "submission_unknown",
      attempt_count: 1,
      terminal_at: null,
    });
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(second.job.id)
        .first(),
    ).toEqual({ held_bytes: MEDIA_LIMITS.imageBytes });
  });
  it("90-day ledger purge never releases unconfirmed stored bytes; physical delete CAS works after ledger purge", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(
      context,
      mediaInput(0, { prompt: "x", count: 2 }),
    );
    await allowNextMediaPoll(job.id);
    const stored = await advanceMediaJob(context, job.id);
    const assets = (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).assets;
    await maintainMediaRetention(
      database,
      (stored.terminalAt ?? 0) + MEDIA_LIMITS.ledgerRetentionMs,
    );
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: 2048 });
    await expect(
      confirmMediaAssetDeletion(
        database,
        MEDIA_ALICE.id,
        assets[0].id,
        async () => false,
      ),
    ).rejects.toMatchObject({ code: "media_delete_pending" });
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: 2048 });
    await Promise.all([
      confirmMediaAssetDeletion(
        database,
        MEDIA_ALICE.id,
        assets[0].id,
        async () => true,
      ),
      confirmMediaAssetDeletion(
        database,
        MEDIA_ALICE.id,
        assets[0].id,
        async () => true,
      ),
    ]);
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: 1024 });
    await confirmMediaAssetDeletion(
      database,
      MEDIA_ALICE.id,
      assets[1].id,
      async () => true,
    );
    expect(
      await database
        .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
        .first(),
    ).toEqual({ n: 0 });
  });
  it("recovery requires authoritative witness and external reconciliation, reapplies early erasure without resurrecting spent usage", async () => {
    const driver = mediaDriver();
    driver.submit.mockResolvedValue({ outcome: "rejected" });
    const request = mediaInput();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    await expect(submitMedia(context, request)).rejects.toMatchObject({
      status: 502,
    });
    const job = await submitMedia(context, request);
    await eraseMediaBody(MEDIA_ENV, MEDIA_ALICE, job.id);
    await blockMediaRecovery(database);
    const witness = await readMediaRecoveryWitness(database);
    // 合成復元: 消去済み本文だけが巻き戻った状態。実Time Travelは呼ばない。
    await database.batch([
      database
        .prepare("UPDATE media_jobs SET body_erased_at=NULL WHERE id=?")
        .bind(job.id),
      database
        .prepare("INSERT INTO media_job_bodies VALUES(?,?,?)")
        .bind(
          job.id,
          MEDIA_ALICE.id,
          JSON.stringify({ prompt: "TEST_ONLY_restored_body" }),
        ),
    ]);
    await expect(
      reconcileMediaRecovery(database, undefined, async () => true),
    ).rejects.toMatchObject({ code: "media_recovery_witness_required" });
    await expect(
      reconcileMediaRecovery(database, witness, async () => false),
    ).rejects.toMatchObject({
      code: "media_recovery_external_reconciliation_required",
    });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_job_bodies")
        .first(),
    ).toEqual({ n: 0 });
    expect(
      await reconcileMediaRecovery(database, witness, async () => true),
    ).toEqual({ isReconciled: true });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
    expect((await submitMedia(context, request)).id).toBe(job.id);
    expect(driver.submit).toHaveBeenCalledTimes(1);
  });
  it("missing consumption or changed legacy records fail closed; unknown cannot be auto-resumed", async () => {
    const driver = mediaDriver();
    driver.submit.mockRejectedValue(new Error("TEST_ONLY_lost_ack"));
    const request = mediaInput();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    await expect(submitMedia(context, request)).rejects.toMatchObject({
      status: 502,
    });
    const job = await submitMedia(context, request);
    const witness = await readMediaRecoveryWitness(database);
    await expect(
      reconcileMediaRecovery(database, witness, async () => true),
    ).rejects.toMatchObject({ code: "media_recovery_unresolved_jobs" });
    await expect(submitMedia(context, mediaInput())).rejects.toMatchObject({
      code: "media_recovery_blocked",
    });
    await database
      .prepare("DELETE FROM media_usage_events WHERE job_id=?")
      .bind(job.id)
      .run();
    await expect(
      reconcileMediaRecovery(database, witness, async () => true),
    ).rejects.toMatchObject({
      code: "media_recovery_manual_reconciliation_required",
    });
    expect(
      await database
        .prepare("SELECT is_recovery_blocked FROM media_runtime_state")
        .first(),
    ).toEqual({ is_recovery_blocked: 1 });
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: MEDIA_LIMITS.imageBytes });
    expect(driver.submit).toHaveBeenCalledTimes(1);
  });
});
