import { checkExtensionRuntimePolicy } from "../ai-verification";
import { ApiError } from "../http";
import { ownedAsset } from "./assets";
import { IMAGE_MIMES } from "./image-inspection";
import { mediaDatabase, ownedMediaJob } from "./ledger";
import {
  type MediaEnv,
  requireMediaBucket,
  requireMediaEnabled,
} from "./policy";

export const GRANT_LIFETIME_MS = 30 * 60_000;
export const GRANT_HEAD_LIMIT = 20;
async function tokenHash(token: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
/** URLはadapterの一時入力だけ。HTTP応答/本文/ログ/台帳には保存しない。 */
export async function createReferenceGrants(
  env: MediaEnv,
  owner: string,
  jobId: string,
) {
  const job = await ownedMediaJob(env.DB, owner, jobId);
  if (
    job.provider_state !== "submitting" ||
    job.cancel_requested_at !== null ||
    job.body_erased_at !== null ||
    (job.lease_until ?? 0) <= Date.now()
  )
    throw new ApiError(409, "media_submission_not_claimed");
  const links = await mediaDatabase(
    env.DB.prepare(
      "SELECT asset_id,asset_version,role,ordinal FROM media_job_assets WHERE job_id=? AND owner_id=? AND role!='output' ORDER BY CASE role WHEN 'reference' THEN 0 ELSE 1 END,ordinal",
    )
      .bind(jobId, owner)
      .all<{
        asset_id: string;
        asset_version: number;
        role: string;
        ordinal: number;
      }>(),
  );
  const grants: { role: string; ordinal: number; url: string }[] = [];
  for (const link of links.results) {
    if (!["reference", "mask", "start", "end"].includes(link.role))
      throw new ApiError(400, "media_reference_invalid");
    const asset = await ownedAsset(env.DB, owner, link.asset_id),
      now = Date.now();
    if (
      asset.state !== "ready" ||
      asset.version !== link.asset_version ||
      asset.expires_at < now + GRANT_LIFETIME_MS
    )
      throw new ApiError(400, "media_reference_unavailable");
    const id = crypto.randomUUID(),
      token = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    const result = await mediaDatabase(
      env.DB.prepare(`INSERT INTO media_asset_grants(id,token_hash,job_id,asset_id,owner_id,asset_version,role,ordinal,purpose,expires_at)
      SELECT ?,?,?,?,?,?,?,?,'fal-reference',? WHERE EXISTS(SELECT 1 FROM media_assets WHERE id=? AND owner_id=? AND version=? AND state='ready' AND expires_at>=?) AND EXISTS(SELECT 1 FROM media_jobs WHERE id=? AND owner_id=? AND provider_state='submitting' AND lease_until>? AND cancel_requested_at IS NULL AND body_erased_at IS NULL) AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0`)
        .bind(
          id,
          await tokenHash(token),
          jobId,
          asset.id,
          owner,
          asset.version,
          link.role,
          link.ordinal,
          now + GRANT_LIFETIME_MS,
          asset.id,
          owner,
          asset.version,
          now + GRANT_LIFETIME_MS,
          jobId,
          owner,
          now,
        )
        .run(),
    );
    if (result.meta.changes !== 1)
      throw new ApiError(409, "media_reference_unavailable");
    grants.push({
      role: link.role,
      ordinal: link.ordinal,
      url: `${env.APP_ORIGIN}/api/media-source/${id}?token=${token}`,
    });
  }
  return grants;
}
const LIVE_GRANT = `SELECT g.id FROM media_asset_grants g JOIN media_assets a ON a.id=g.asset_id AND a.owner_id=g.owner_id JOIN media_jobs j ON j.id=g.job_id AND j.owner_id=g.owner_id
  WHERE g.id=? AND g.token_hash=? AND g.purpose='fal-reference' AND g.revoked_at IS NULL AND g.expires_at>? AND a.state='ready' AND a.version=g.asset_version AND a.expires_at>? AND j.cancel_requested_at IS NULL AND j.body_erased_at IS NULL AND j.terminal_at IS NULL AND j.provider_state IN ('submitting','submission_unknown','queued','running') AND EXISTS(SELECT 1 FROM media_job_assets l WHERE l.job_id=g.job_id AND l.asset_id=g.asset_id AND l.owner_id=g.owner_id AND l.asset_version=g.asset_version AND l.role=g.role AND l.ordinal=g.ordinal) AND (SELECT is_recovery_blocked FROM media_runtime_state WHERE id=1)=0`;
export async function handleMediaSource(request: Request, env: MediaEnv) {
  requireMediaEnabled(env);
  const url = new URL(request.url),
    match = /^\/api\/media-source\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (
    !match ||
    url.searchParams.size !== 1 ||
    !/^[a-f0-9]{64}$/.test(url.searchParams.get("token") ?? "")
  )
    throw new ApiError(404, "not_found");
  if (!["GET", "HEAD"].includes(request.method))
    throw new ApiError(405, "method_not_allowed");
  if (
    request.headers.has("Origin") &&
    request.headers.get("Origin") !== url.origin
  )
    throw new ApiError(403, "origin_not_allowed");
  if (request.headers.has("Range"))
    throw new ApiError(416, "media_range_unsupported");
  await checkExtensionRuntimePolicy(env);
  const hash = await tokenHash(url.searchParams.get("token") ?? ""),
    now = Date.now(),
    isHead = request.method === "HEAD";
  const result = await mediaDatabase(
    env.DB.prepare(`UPDATE media_asset_grants SET ${isHead ? "head_count=head_count+1" : "get_count=get_count+1,transferred_bytes=transferred_bytes+(SELECT bytes FROM media_assets WHERE id=asset_id)"}
    WHERE id IN(${LIVE_GRANT}) AND ${isHead ? "head_count<20" : "get_count<20 AND transferred_bytes+(SELECT bytes FROM media_assets WHERE id=asset_id)<=(SELECT bytes*10 FROM media_assets WHERE id=asset_id)"}`)
      .bind(match[1], hash, now, now)
      .run(),
  );
  if (result.meta.changes !== 1) throw new ApiError(404, "not_found");
  const grant = await mediaDatabase(
    env.DB.prepare(
      "SELECT asset_id,owner_id FROM media_asset_grants WHERE id=?",
    )
      .bind(match[1])
      .first<{ asset_id: string; owner_id: string }>(),
  );
  if (!grant) throw new ApiError(404, "not_found");
  const asset = await ownedAsset(env.DB, grant.owner_id, grant.asset_id),
    bucket = requireMediaBucket(env);
  const object = isHead
    ? await bucket.head(asset.object_key)
    : await bucket.get(asset.object_key);
  const live = await mediaDatabase(
    env.DB.prepare(LIVE_GRANT)
      .bind(match[1], hash, Date.now(), Date.now())
      .first(),
  );
  if (
    !object ||
    !live ||
    object.size !== asset.bytes ||
    !["png", "jpeg", "webp"].includes(asset.format)
  ) {
    if (object && "body" in object)
      await (object as R2ObjectBody).body.cancel().catch(() => {});
    throw new ApiError(404, "not_found");
  }
  return new Response("body" in object ? (object as R2ObjectBody).body : null, {
    headers: {
      "Content-Type": IMAGE_MIMES[asset.format as keyof typeof IMAGE_MIMES],
      "Content-Length": String(asset.bytes),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
