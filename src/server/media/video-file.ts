import type { Identity } from "../env";
import { ApiError } from "../http";
import { ownedAsset } from "./assets";
import type { MediaAsset } from "./ledger";
import { type MediaEnv, requireMediaBucket } from "./policy";

function byteRange(value: string, bytes: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, bytes - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), bytes - 1)
      : bytes - 1
    : bytes - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (!match[1] &&
      (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) === 0)) ||
    start < 0 ||
    start >= bytes ||
    end < start
  )
    return null;
  return { offset: start, length: end - start + 1 };
}
/** 認証・所有権の後に呼ぶ。HEADではRangeを無視する（RFC 9110）。 */
export async function videoFile(
  request: Request,
  env: MediaEnv,
  identity: Identity,
  asset: MediaAsset,
) {
  const bucket = requireMediaBucket(env),
    head = await bucket.head(asset.object_key);
  if (!head || head.size !== asset.bytes) throw new ApiError(404, "not_found");
  const current = await ownedAsset(env.DB, identity.id, asset.id);
  if (
    current.state !== "ready" ||
    current.expires_at <= Date.now() ||
    current.version !== asset.version
  )
    throw new ApiError(404, "not_found");
  const modified = head.uploaded.toUTCString();
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    ETag: head.httpEtag,
    "Last-Modified": modified,
  };
  if (request.method === "HEAD")
    return new Response(null, {
      headers: { ...headers, "Content-Length": String(asset.bytes) },
    });
  const rangeHeader = request.headers.get("Range"),
    ifRange = request.headers.get("If-Range");
  const canRange = ifRange === null || ifRange === head.httpEtag;
  const range =
    rangeHeader !== null && canRange
      ? byteRange(rangeHeader, asset.bytes)
      : undefined;
  if (range === null)
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${asset.bytes}`,
        "Content-Length": "0",
      },
    });
  const object = await bucket.get(asset.object_key, {
    onlyIf: { etagMatches: head.etag },
    ...(range ? { range } : {}),
  });
  const latest = await ownedAsset(env.DB, identity.id, asset.id);
  if (
    !object ||
    !("body" in object) ||
    object.size !== asset.bytes ||
    latest.state !== "ready" ||
    latest.expires_at <= Date.now() ||
    latest.version !== asset.version ||
    request.signal.aborted
  ) {
    if (object && "body" in object) await object.body.cancel().catch(() => {});
    throw new ApiError(404, "not_found");
  }
  return new Response(object.body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      "Content-Length": String(range?.length ?? asset.bytes),
      ...(range
        ? {
            "Content-Range": `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.bytes}`,
          }
        : {}),
    },
  });
}
