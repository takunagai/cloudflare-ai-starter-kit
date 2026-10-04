import { beforeEach, describe, expect, it } from "vitest";
import { deleteAsset } from "../src/server/media/assets";
import { normalizeMedia } from "../src/server/media/catalog";
import {
  createReferenceGrants,
  handleMediaSource,
} from "../src/server/media/grants";
import {
  claimMediaSubmission,
  reserveMedia,
  validateReferences,
} from "../src/server/media/ledger";
import {
  blockMediaRecovery,
  eraseMediaBody,
} from "../src/server/media/retention";
import { requestMediaCancellation } from "../src/server/media/service";
import {
  MEDIA_ALICE as alice,
  MEDIA_DATABASE as database,
  MEDIA_ENV,
  mediaInput,
  resetMediaDatabase,
} from "./media-fixtures";
import { savedMediaImage, syntheticPng } from "./media-image-fixtures";

beforeEach(resetMediaDatabase);
async function grantFixture() {
  const asset = await savedMediaImage(await syntheticPng(16, 16));
  const media = normalizeMedia(
      mediaInput(1, { prompt: "TEST_ONLY_edit", references: [asset.id] }),
    ),
    now = Date.now();
  const reservation = await reserveMedia(
    database,
    alice.id,
    media,
    "a".repeat(64),
    await validateReferences(database, alice.id, media, now),
    now,
  );
  const job = await claimMediaSubmission(database, reservation.job, now);
  const [grant] = await createReferenceGrants(MEDIA_ENV, alice.id, job.id);
  return {
    asset,
    job,
    grant,
    id: new URL(grant.url).pathname.split("/").at(-1),
  };
}
describe("M-2 token-only source grants in workerd/D1/R2", () => {
  it("creates bound hash-only capability with 30-minute expiry and no object key/owner/session in URL", async () => {
    const { asset, job, grant, id } = await grantFixture();
    const row = await database
      .prepare("SELECT * FROM media_asset_grants WHERE id=?")
      .bind(id)
      .first<{
        token_hash: string;
        owner_id: string;
        asset_version: number;
        purpose: string;
        expires_at: number;
      }>();
    expect(row).toMatchObject({
      owner_id: alice.id,
      asset_version: asset.version,
      purpose: "fal-reference",
    });
    expect(row?.token_hash).toHaveLength(64);
    expect(row?.token_hash).not.toBe(
      new URL(grant.url).searchParams.get("token"),
    );
    expect((row?.expires_at ?? 0) - Date.now()).toBeLessThanOrEqual(1800000);
    expect(grant.url).not.toContain(alice.id);
    expect(grant.url).not.toContain("media/uploads");
    const response = await handleMediaSource(new Request(grant.url), MEDIA_ENV);
    expect(response.status).toBe(200);
    await response.body?.cancel();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(
      await database
        .prepare(
          "SELECT get_count,transferred_bytes FROM media_asset_grants WHERE id=?",
        )
        .bind(id)
        .first(),
    ).toEqual({ get_count: 1, transferred_bytes: asset.bytes });
    expect(job.terminal_at).toBeNull();
  });
  it("atomically limits total GET bytes to ten files and HEAD to20 under concurrent calls", async () => {
    const { grant, id, asset } = await grantFixture();
    const getResults = await Promise.allSettled(
      Array.from({ length: 12 }, async () => {
        const response = await handleMediaSource(
          new Request(grant.url),
          MEDIA_ENV,
        );
        await response.body?.cancel();
        return response.status;
      }),
    );
    expect(
      getResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(10);
    const headResults = await Promise.allSettled(
      Array.from({ length: 22 }, () =>
        handleMediaSource(
          new Request(grant.url, { method: "HEAD" }),
          MEDIA_ENV,
        ),
      ),
    );
    expect(
      headResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(20);
    expect(
      await database
        .prepare(
          "SELECT get_count,head_count,transferred_bytes FROM media_asset_grants WHERE id=?",
        )
        .bind(id)
        .first(),
    ).toEqual({
      get_count: 10,
      head_count: 20,
      transferred_bytes: asset.bytes * 10,
    });
  });
  it.each([
    "token",
    "expiry",
    "asset-expiry",
    "version",
    "cancel",
    "erase",
    "complete",
    "delete",
    "gate",
    "off",
  ])("revokes/rejects %s without anonymous access", async (reason) => {
    const { grant, id, asset, job } = await grantFixture();
    let url = grant.url;
    if (reason === "token")
      url = url.replace(/token=.*/, `token=${"0".repeat(64)}`);
    if (reason === "expiry")
      await database
        .prepare("UPDATE media_asset_grants SET expires_at=? WHERE id=?")
        .bind(Date.now(), id)
        .run();
    if (reason === "asset-expiry")
      await database
        .prepare(
          "UPDATE media_assets SET validated_at=0,expires_at=? WHERE id=?",
        )
        .bind(Date.now(), asset.id)
        .run();
    if (reason === "version")
      await database
        .prepare("UPDATE media_assets SET version=2 WHERE id=?")
        .bind(asset.id)
        .run();
    if (reason === "cancel")
      await requestMediaCancellation(MEDIA_ENV, alice, job.id);
    if (reason === "erase") await eraseMediaBody(MEDIA_ENV, alice, job.id);
    if (reason === "complete")
      await database
        .prepare(
          "UPDATE media_jobs SET provider_id='TEST_ONLY_id',provider_state='completed' WHERE id=?",
        )
        .bind(job.id)
        .run();
    if (reason === "delete") await deleteAsset(MEDIA_ENV, alice, asset.id);
    if (reason === "gate") await blockMediaRecovery(database);
    await expect(
      handleMediaSource(
        new Request(url),
        reason === "off"
          ? { ...MEDIA_ENV, ENABLE_MEDIA: "false", MEDIA_ALLOWED_MODELS: "[]" }
          : MEDIA_ENV,
      ),
    ).rejects.toThrow();
  });
  it("rejects path/query aliases, Range, foreign origin, methods and missing tokens", async () => {
    const { grant } = await grantFixture();
    const url = new URL(grant.url);
    for (const request of [
      new Request(url.origin + url.pathname),
      new Request(`${grant.url}&token=${"1".repeat(64)}`),
      new Request(grant.url.replace("?", "/?")),
      new Request(grant.url.replace("media-source/", "media-source//")),
      new Request(grant.url, { method: "POST" }),
      new Request(grant.url, { headers: { Range: "bytes=0-1" } }),
      new Request(grant.url, {
        headers: { Origin: "https://foreign.example.invalid" },
      }),
    ])
      await expect(handleMediaSource(request, MEDIA_ENV)).rejects.toThrow();
  });
  it("does not extend expiry or release unknown processing when grant expires", async () => {
    const { grant, id, job } = await grantFixture();
    await database
      .prepare(
        "UPDATE media_jobs SET provider_state='submission_unknown',lease_token=NULL,lease_until=NULL WHERE id=?",
      )
      .bind(job.id)
      .run();
    await database
      .prepare("UPDATE media_asset_grants SET expires_at=1 WHERE id=?")
      .bind(id)
      .run();
    await expect(
      handleMediaSource(new Request(grant.url), MEDIA_ENV),
    ).rejects.toThrow();
    expect(
      await database
        .prepare(
          "SELECT terminal_at,attempt_count,provider_state FROM media_jobs WHERE id=?",
        )
        .bind(job.id)
        .first(),
    ).toEqual({
      terminal_at: null,
      attempt_count: 1,
      provider_state: "submission_unknown",
    });
    expect(
      (
        await database
          .prepare(
            "SELECT held_bytes FROM media_storage_reservations WHERE job_id=?",
          )
          .bind(job.id)
          .first<{ held_bytes: number }>()
      )?.held_bytes,
    ).toBe(20 * 1024 * 1024);
  });
});
