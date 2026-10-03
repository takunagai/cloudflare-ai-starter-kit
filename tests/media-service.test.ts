import { beforeEach, describe, expect, it, vi } from "vitest";
import { imageInputSchema, submitImage } from "../src/server/extensions/images";
import { MEDIA_LIMITS, MEDIA_MODEL_IDS } from "../src/server/media/catalog";
import { ownedMediaJob } from "../src/server/media/ledger";
import { mediaPolicy } from "../src/server/media/policy";
import {
  eraseMediaBody,
  maintainMediaRetention,
  resolveUnknownMediaSubmission,
} from "../src/server/media/retention";
import {
  advanceMediaJob,
  getMediaJob,
  listMediaJobs,
  requestMediaCancellation,
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
  mediaReceipts,
  resetMediaDatabase,
  syntheticReference,
} from "./media-fixtures";

beforeEach(resetMediaDatabase);

describe("M-1 common media service with fake upstream and real workerd/D1", () => {
  it.each(MEDIA_MODEL_IDS)(
    "executes %s through the shared service and verified receipt boundary",
    async (model) => {
      const index = MEDIA_MODEL_IDS.indexOf(model);
      const driver = mediaDriver();
      const reference =
        index === 1 || index === 3 || index === 5 || index === 6 || index === 7
          ? await syntheticReference(MEDIA_ALICE.id)
          : undefined;
      const request = mediaInput(index);
      if (index === 1 || index === 3 || index === 6)
        request.input.references = [reference];
      if (index === 5 || index === 7) request.input.start = reference;
      if (index === 7)
        request.input.keyframes = [
          { time: 0, azimuth: 0, elevation: 0, distance: 1 },
          { time: 1, azimuth: 90, elevation: 0, distance: 1 },
        ];
      const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
      const job = await submitMedia(context, request);
      expect(job.providerState).toBe("queued");
      await allowNextMediaPoll(job.id);
      expect(await advanceMediaJob(context, job.id)).toMatchObject({
        providerState: "completed",
        collectionState: "stored",
        terminalOutcome: "stored",
      });
      expect(driver.submit).toHaveBeenCalledTimes(1);
      expect(driver.submit.mock.calls[0][1].headers).toMatchObject({
        "X-Fal-No-Retry": "1",
        "x-app-fal-disable-fallback": "true",
        "X-Fal-Store-IO": "0",
      });
      expect(
        (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).assets,
      ).toHaveLength(1);
      expect(
        await database
          .prepare(
            "SELECT held_bytes,state FROM media_storage_reservations WHERE job_id=?",
          )
          .bind(job.id)
          .first(),
      ).toEqual({ held_bytes: 1024, state: "stored" });
    },
  );
  it("concurrent same input sends once, normalized defaults replay, changed input conflicts", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const request = mediaInput();
    const [first, duplicate] = await Promise.all([
      submitMedia(context, request),
      submitMedia(context, request),
    ]);
    expect(first.id).toBe(duplicate.id);
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(
      (
        await submitMedia(context, {
          ...request,
          input: {
            ...request.input,
            quality: "medium",
            count: 1,
            size: { width: 1024, height: 1024 },
            format: "png",
            background: "auto",
          },
        })
      ).id,
    ).toBe(first.id);
    await expect(
      submitMedia(context, {
        ...request,
        input: { prompt: "TEST_ONLY_changed" },
      }),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_conflict" });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
  });
  it("competing owner requests reserve only one; four different owners reserve only three", async () => {
    const driver = mediaDriver();
    const own = await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        submitMedia(
          { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
          mediaInput(),
        ),
      ),
    );
    expect(own.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(driver.submit).toHaveBeenCalledTimes(1);
    const others = await Promise.allSettled(
      Array.from({ length: 3 }, (_, index) =>
        submitMedia(
          {
            env: MEDIA_ENV,
            identity: { ...MEDIA_BOB, id: `TEST_ONLY_media_owner_${index}` },
            driver,
          },
          mediaInput(),
        ),
      ),
    );
    expect(
      others.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(driver.submit).toHaveBeenCalledTimes(3);
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_active_jobs")
        .first(),
    ).toEqual({ n: 3 });
  });
  it.each([
    [0, { prompt: "x" }, 10],
    [0, { prompt: "x", count: 4 }, 5],
    [4, { prompt: "x", duration: 10 }, 3],
    [8, { mode: "single", text: "x" }, 10],
    [8, { mode: "single", text: "x".repeat(4000) }, 5],
    [11, { prompt: "x", duration: 60 }, 3],
  ] as const)(
    "consumes rolling request/unit limits for kind index %s without refunding rejection",
    async (index, input, maximum) => {
      const driver = mediaDriver();
      driver.submit.mockResolvedValue({ outcome: "rejected" });
      const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
      for (let attempt = 0; attempt < maximum; attempt++)
        await expect(
          submitMedia(context, mediaInput(index, input)),
        ).rejects.toMatchObject({ code: "media_submission_rejected" });
      await expect(
        submitMedia(context, mediaInput(index, input)),
      ).rejects.toMatchObject({ status: 429, code: "media_limit_reached" });
      expect(driver.submit).toHaveBeenCalledTimes(maximum);
      expect(
        await database
          .prepare("SELECT sum(held_bytes) AS n FROM media_storage_holds")
          .first(),
      ).toEqual({ n: 0 });
    },
  );
  it("atomically rejects owner/environment storage including pending and quarantined bytes", async () => {
    const driver = mediaDriver();
    await syntheticReference(MEDIA_ALICE.id, {
      bytes: MEDIA_LIMITS.ownerStorageBytes - MEDIA_LIMITS.imageBytes + 1,
    });
    await expect(
      submitMedia(
        { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
        mediaInput(),
      ),
    ).rejects.toMatchObject({ status: 429 });
    await database.prepare("UPDATE media_assets SET state='quarantined'").run();
    await expect(
      submitMedia(
        { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
        mediaInput(),
      ),
    ).rejects.toMatchObject({ status: 429 });
    for (let index = 0; index < 10; index++)
      await syntheticReference(`TEST_ONLY_storage_${index}`, {
        bytes: MEDIA_LIMITS.ownerStorageBytes,
      });
    await expect(
      submitMedia(
        { env: MEDIA_ENV, identity: MEDIA_BOB, driver },
        mediaInput(),
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(driver.submit).not.toHaveBeenCalled();
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
  });
  it("checks ownership and reference readiness/version/expiry before paid dispatch", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const foreign = await syntheticReference(MEDIA_BOB.id);
    const expiring = await syntheticReference(MEDIA_ALICE.id, {
      expiresAt: Date.now() + 1799000,
    });
    for (const reference of [foreign, expiring, crypto.randomUUID()])
      await expect(
        submitMedia(
          context,
          mediaInput(1, { prompt: "x", references: [reference] }),
        ),
      ).rejects.toMatchObject({ status: 400 });
    const job = await submitMedia(context, mediaInput());
    await expect(
      getMediaJob(MEDIA_ENV, MEDIA_BOB, job.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requestMediaCancellation(MEDIA_ENV, MEDIA_BOB, job.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      eraseMediaBody(MEDIA_ENV, MEDIA_BOB, job.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      advanceMediaJob({ ...context, identity: MEDIA_BOB }, job.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(driver.status).not.toHaveBeenCalled();
  });
  it("retains timeout uncertainty and both capacity/concurrency even after90 days and body erasure", async () => {
    const driver = mediaDriver();
    driver.submit.mockImplementation(() => new Promise(() => {}));
    const request = mediaInput();
    const context = {
      env: MEDIA_ENV,
      identity: MEDIA_ALICE,
      driver,
      timeoutMs: 5,
    };
    await expect(submitMedia(context, request)).rejects.toMatchObject({
      status: 502,
    });
    const job = await submitMedia(context, request);
    expect(job.providerState).toBe("submission_unknown");
    await maintainMediaRetention(database, Date.now() + 91 * 86400000);
    expect(
      (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).input,
    ).not.toBeNull();
    await eraseMediaBody(
      { ...MEDIA_ENV, ENABLE_MEDIA: "false", MEDIA_ALLOWED_MODELS: "[]" },
      MEDIA_ALICE,
      job.id,
    );
    await maintainMediaRetention(database, Date.now() + 91 * 86400000);
    expect((await submitMedia(context, request)).bodyAvailable).toBe(false);
    await expect(submitMedia(context, mediaInput())).rejects.toMatchObject({
      status: 429,
    });
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: MEDIA_LIMITS.imageBytes });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
  });
  it("provider completion alone is nonterminal, retries only collection and keeps partial receipts stable", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(
      context,
      mediaInput(0, { prompt: "x", count: 2 }),
    );
    const row = await ownedMediaJob(database, MEDIA_ALICE.id, job.id);
    const assets = mediaReceipts(row);
    driver.collect
      .mockResolvedValueOnce({
        assets: assets.slice(0, 1),
        isComplete: false,
        hasInvalidOutput: false,
      })
      .mockResolvedValueOnce({
        assets,
        isComplete: true,
        hasInvalidOutput: false,
      });
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      providerState: "completed",
      collectionState: "collection_failed",
      terminalAt: null,
    });
    await expect(submitMedia(context, mediaInput())).rejects.toMatchObject({
      status: 429,
    });
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "stored",
    });
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(driver.status).toHaveBeenCalledTimes(1);
    expect(driver.collect).toHaveBeenCalledTimes(2);
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_assets WHERE source='result'")
        .first(),
    ).toEqual({ n: 2 });
    expect(
      (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).assets.map(
        (asset) => asset.expires_at,
      ),
    ).toEqual(
      assets.map((asset) => asset.validatedAt + MEDIA_LIMITS.outputLifetimeMs),
    );
  });
  it("caps automatic collection retries at3 without resubmitting or releasing slots", async () => {
    const driver = mediaDriver();
    driver.collect.mockRejectedValue(new Error("TEST_ONLY_private_error"));
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(context, mediaInput());
    for (let index = 0; index < 3; index++) {
      await allowNextMediaPoll(job.id);
      await expect(advanceMediaJob(context, job.id)).rejects.toMatchObject({
        code: "media_collection_unavailable",
      });
    }
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toMatchObject({
      code: "media_collection_retry_limit",
    });
    expect(driver.collect).toHaveBeenCalledTimes(3);
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(
      (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).terminalAt,
    ).toBeNull();
  });
  it("cancel acceptance never proves termination; completion after cancellation must be discarded", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(context, mediaInput());
    await requestMediaCancellation(
      { ...MEDIA_ENV, ENABLE_MEDIA: "false", MEDIA_ALLOWED_MODELS: "[]" },
      MEDIA_ALICE,
      job.id,
    );
    driver.status.mockResolvedValueOnce("running");
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      providerState: "running",
      isCancellationRequested: true,
      terminalAt: null,
    });
    await expect(submitMedia(context, mediaInput())).rejects.toMatchObject({
      status: 429,
    });
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "discarded",
    });
    expect(driver.cancel).toHaveBeenCalledTimes(1);
    expect(driver.collect).not.toHaveBeenCalled();
    expect(driver.discard).toHaveBeenCalledTimes(1);
    expect(
      await database
        .prepare("SELECT quantity FROM media_usage_events WHERE job_id=?")
        .bind(job.id)
        .first(),
    ).toEqual({ quantity: 1 });
  });
  it("cancel during collection preserves deletion intent; failed physical deletion retains bytes until confirmed", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(context, mediaInput());
    driver.collect.mockImplementationOnce(async (row) => {
      await requestMediaCancellation(MEDIA_ENV, MEDIA_ALICE, job.id);
      return {
        assets: mediaReceipts(row),
        isComplete: true,
        hasInvalidOutput: false,
      };
    });
    driver.discard.mockRejectedValueOnce(new Error("TEST_ONLY_delete_failure"));
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toMatchObject({
      status: 502,
    });
    expect(
      (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).terminalAt,
    ).toBeNull();
    expect(
      await database
        .prepare(
          "SELECT held_bytes,state FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 1024, state: "deleting" });
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "discarded",
    });
    expect(driver.collect).toHaveBeenCalledTimes(1);
    expect(driver.submit).toHaveBeenCalledTimes(1);
    expect(
      await database
        .prepare("SELECT state FROM media_assets WHERE source='result'")
        .first(),
    ).toEqual({ state: "deleted" });
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: 0 });
  });
  it("concurrent refresh has one lease; stale poll cannot overwrite a newer stored result", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(context, mediaInput());
    let release: (value: "queued") => void = () => {};
    let started: () => void = () => {};
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    driver.status.mockImplementationOnce(async () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    await allowNextMediaPoll(job.id);
    const stale = advanceMediaJob(context, job.id);
    await didStart;
    expect((await advanceMediaJob(context, job.id)).terminalAt).toBeNull();
    expect(driver.status).toHaveBeenCalledTimes(1);
    await database
      .prepare("UPDATE media_jobs SET lease_until=0 WHERE id=?")
      .bind(job.id)
      .run();
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "stored",
    });
    release("queued");
    await expect(stale).rejects.toMatchObject({ code: "media_lease_lost" });
    expect(
      (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).terminalOutcome,
    ).toBe("stored");
  });
  it("untrusted output receipt cannot create fake success or refund without physical discard", async () => {
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const job = await submitMedia(context, mediaInput());
    driver.collect.mockImplementationOnce(async (row) => ({
      assets: [
        { ...mediaReceipts(row)[0], bytes: MEDIA_LIMITS.imageBytes + 1 },
      ],
      isComplete: true,
      hasInvalidOutput: false,
    }));
    await allowNextMediaPoll(job.id);
    await expect(advanceMediaJob(context, job.id)).rejects.toMatchObject({
      code: "media_result_invalid",
    });
    expect(
      (await getMediaJob(MEDIA_ENV, MEDIA_ALICE, job.id)).terminalAt,
    ).toBeNull();
    expect(
      await database
        .prepare(
          "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({ held_bytes: MEDIA_LIMITS.imageBytes });
    await allowNextMediaPoll(job.id);
    expect(await advanceMediaJob(context, job.id)).toMatchObject({
      terminalOutcome: "invalid",
    });
    expect(driver.discard).toHaveBeenCalledTimes(1);
    expect(driver.submit).toHaveBeenCalledTimes(1);
  });
  it("shares legacy active/usage/storage limits and rejects cross-generation request UUID collisions", async () => {
    const uuid = crypto.randomUUID();
    const legacyInput = imageInputSchema.parse({
      requestId: uuid,
      model: "fal-ai/flux/schnell",
      prompt: "TEST_ONLY_old",
    });
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        request_id: "TEST_ONLY_old_provider",
        status_url:
          "https://queue.fal.run/fal-ai/flux/requests/TEST_ONLY_old_provider/status",
        response_url:
          "https://queue.fal.run/fal-ai/flux/requests/TEST_ONLY_old_provider",
        cancel_url:
          "https://queue.fal.run/fal-ai/flux/requests/TEST_ONLY_old_provider/cancel",
      }),
    );
    const legacy = await submitImage(
      { ...MEDIA_ENV, ENABLE_IMAGES: "true" },
      MEDIA_ALICE,
      legacyInput,
      fetcher,
    );
    const driver = mediaDriver();
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    await expect(submitMedia(context, mediaInput())).rejects.toMatchObject({
      status: 429,
    });
    await expect(
      submitMedia(
        context,
        mediaInput(
          0,
          undefined,
          `${new Date().toISOString().slice(0, 10)}:${uuid}`,
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listMediaJobs(MEDIA_ENV, MEDIA_ALICE)).jobs).toContainEqual(
      expect.objectContaining({
        id: legacy.id,
        isLegacy: true,
        isPrivatelyStored: false,
      }),
    );
    await database
      .prepare("UPDATE image_jobs SET state='failed' WHERE id=?")
      .bind(legacy.id)
      .run();
    const request = mediaInput();
    await submitMedia(context, request);
    await expect(
      submitImage(
        { ...MEDIA_ENV, ENABLE_IMAGES: "true" },
        MEDIA_ALICE,
        { ...legacyInput, requestId: request.requestId.slice(11) },
        fetcher,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("OFF/unset/bad config/unknown model/legacy staging have zero upstream calls", async () => {
    const driver = mediaDriver();
    for (const patch of [
      { ENABLE_MEDIA: undefined, FAL_KEY: undefined },
      { ENABLE_MEDIA: "false", FAL_KEY: undefined },
      { MEDIA_ALLOWED_MODELS: undefined },
      { MEDIA_ALLOWED_MODELS: '["unknown"]' },
      { FAL_KEY: undefined },
      { APP_ENV: "staging", STAGING_POLICY: undefined },
      { APP_ENV: "staging", STAGING_POLICY: "verification" },
    ] as const)
      await expect(
        submitMedia(
          { env: { ...MEDIA_ENV, ...patch }, identity: MEDIA_ALICE, driver },
          mediaInput(),
        ),
      ).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(
      submitMedia(
        { env: MEDIA_ENV, identity: MEDIA_ALICE, driver },
        { ...mediaInput(), model: "arbitrary" },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      submitMedia(
        {
          env: {
            ...MEDIA_ENV,
            MEDIA_ALLOWED_MODELS: JSON.stringify([MEDIA_MODEL_IDS[1]]),
          },
          identity: MEDIA_ALICE,
          driver,
        },
        mediaInput(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mediaPolicy({})).toEqual({ isEnabled: false, allowedModels: [] });
    expect(driver.submit).not.toHaveBeenCalled();
    expect(
      await database.prepare("SELECT count(*) AS n FROM media_jobs").first(),
    ).toEqual({ n: 0 });
  });
  it("unknown resolution requires verified evidence, never retries submit, and preserves consumption", async () => {
    const driver = mediaDriver();
    driver.submit.mockRejectedValue(new Error("TEST_ONLY_lost_ack"));
    const context = { env: MEDIA_ENV, identity: MEDIA_ALICE, driver };
    const request = mediaInput();
    await expect(submitMedia(context, request)).rejects.toMatchObject({
      status: 502,
    });
    const job = await submitMedia(context, request);
    await expect(
      resolveUnknownMediaSubmission(
        database,
        MEDIA_BOB.id,
        job.id,
        async () => ({ outcome: "rejected" }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolveUnknownMediaSubmission(
        database,
        MEDIA_ALICE.id,
        job.id,
        async () => null,
      ),
    ).rejects.toMatchObject({ code: "media_submission_still_unknown" });
    expect(
      await resolveUnknownMediaSubmission(
        database,
        MEDIA_ALICE.id,
        job.id,
        async () => ({ outcome: "rejected" }),
      ),
    ).toMatchObject({ terminalOutcome: "failed" });
    expect(
      await database
        .prepare("SELECT count(*) AS n FROM media_usage_events")
        .first(),
    ).toEqual({ n: 1 });
    expect(driver.submit).toHaveBeenCalledTimes(1);
  });
});
