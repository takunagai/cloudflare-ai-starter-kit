import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

const PORT = process.argv[2] ?? "4173";
assert.match(PORT, /^\d{2,5}$/);
const ORIGIN = `http://127.0.0.1:${PORT}`;
// 合成Workerの明示markerが必須。元DB/実設定/実providerへ実行しない。
assert.deepEqual(await (await fetch(`${ORIGIN}/__m3-fixture`)).json(), {
  isSynthetic: true,
});
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const data = Buffer.alloc(bytes.length + 12);
  data.writeUInt32BE(bytes.length);
  data.write(name, 4);
  data.set(bytes, 8);
  data.writeUInt32BE(crc(data.subarray(4, -4)), data.length - 4);
  return data;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1024);
header.writeUInt32BE(1024, 4);
header[8] = 8;
header[9] = 2;
const IMAGE = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.alloc(1024 * (1024 * 3 + 1)))),
  chunk("IEND", Buffer.alloc(0)),
]);
let cookie = "";
let stage = "startup";
async function call(path, method = "GET", body, headers = {}) {
  return fetch(ORIGIN + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
}
async function main() {
  const page = await call("/media");
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.equal((await call("/api/media/assets")).status, 401);
  for (const mode of [
    "text-to-video",
    "image-to-video",
    "reference-to-video",
    "camera-controls",
  ]) {
    stage = `${mode}:auth`;
    const credentials = {
      name: "TEST_ONLY M3 HTTP",
      email: `test-only-m3-${mode}-${crypto.randomUUID()}@example.test`,
      password: "TEST_ONLY_m3_http_password",
    };
    let auth = await call("/api/auth/sign-up/email", "POST", credentials);
    for (let attempt = 0; auth.status === 429 && attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25000));
      auth = await call("/api/auth/sign-up/email", "POST", credentials);
    }
    if (auth.status !== 200)
      console.error(`HTTP registration status: ${auth.status}`);
    assert.equal(auth.status, 200);
    cookie = auth.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    stage = `${mode}:models`;
    const models = await (await call("/api/media/models")).json();
    assert.equal(models.models.length, 8);
    assert.equal(models.models.filter((model) => model.isExecutable).length, 4);
    stage = `${mode}:upload`;
    const reservation = await (
      await call("/api/media/assets", "POST", {
        bytes: IMAGE.length,
        contentType: "image/png",
      })
    ).json();
    const uploaded = await fetch(ORIGIN + reservation.uploadPath, {
      method: "PUT",
      headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "image/png" },
      body: IMAGE,
    });
    assert.equal(uploaded.status, 200);
    const asset = await uploaded.json();
    const input = {
      prompt: "TEST_ONLY_video",
      duration: 5,
      resolution: "480P",
      ...(mode === "text-to-video"
        ? { aspectRatio: "1:1" }
        : mode === "image-to-video"
          ? { end: asset.id }
          : mode === "reference-to-video"
            ? {
                references: [asset.id],
                start: asset.id,
                aspectRatio: "adaptive",
              }
            : {
                start: asset.id,
                keyframes: [
                  { time: 0, azimuth: 0, elevation: 0, distance: 1 },
                  { time: 1, azimuth: 90, elevation: 0, distance: 1 },
                ],
              }),
    };
    if (mode === "image-to-video")
      assert.equal(
        (
          await call("/api/media/jobs", "POST", {
            requestId: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
            model: `minimax/h3-max/${mode}`,
            input: { prompt: "TEST_ONLY_missing_image" },
          })
        ).status,
        400,
      );
    const request = {
      requestId: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
      model: `minimax/h3-max/${mode}`,
      input,
    };
    stage = `${mode}:submit`;
    const accepted = await call("/api/media/jobs", "POST", request);
    assert.equal(accepted.status, 202);
    const job = await accepted.json();
    const duplicate = await (
      await call("/api/media/jobs", "POST", request)
    ).json();
    assert.equal(duplicate.id, job.id);
    const before = await (await call(`/api/media/jobs/${job.id}`)).json();
    assert.equal(before.providerState, "queued");
    await new Promise((resolve) => setTimeout(resolve, 5100));
    stage = `${mode}:refresh`;
    const refreshed = await call(
      `/api/media/jobs/${job.id}/refresh`,
      "POST",
      {},
    );
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).terminalOutcome, "stored");
    stage = `${mode}:range`;
    const detail = await (await call(`/api/media/jobs/${job.id}`)).json(),
      id = detail.assets[0].id;
    assert.ok(!JSON.stringify(detail).includes("fal.media"));
    const head = await call(`/api/media/assets/${id}/file`, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const range = await call(`/api/media/assets/${id}/file`, "GET", undefined, {
      Range: "bytes=0-31",
      "If-Range": head.headers.get("ETag"),
    });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 32);
    const suffix = await call(
      `/api/media/assets/${id}/file`,
      "GET",
      undefined,
      { Range: "bytes=-100" },
    );
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 100);
    const invalid = await call(
      `/api/media/assets/${id}/file`,
      "GET",
      undefined,
      { Range: "bytes=999999-" },
    );
    assert.equal(invalid.status, 416);
    const mismatch = await call(
      `/api/media/assets/${id}/file`,
      "GET",
      undefined,
      { Range: "bytes=0-31", "If-Range": '"TEST_ONLY_other"' },
    );
    assert.equal(mismatch.status, 200);
    await mismatch.body.cancel();
    assert.equal((await call(`/api/media/assets/${id}`, "DELETE")).status, 200);
    assert.equal((await call(`/api/media/assets/${id}/file`)).status, 404);
    assert.equal((await call("/api/auth/sign-out", "POST", {})).status, 200);
    cookie = "";
    assert.equal(
      (await call(`/api/media/assets/${id}/file`, "HEAD")).status,
      401,
    );
    console.log(
      `PASS: ${mode} fake preview / authenticated video / reload / Range / deletion`,
    );
  }
}
main().catch(() => {
  console.error(`FAIL: M-3 isolated synthetic preview HTTP (${stage})`);
  process.exitCode = 1;
});
