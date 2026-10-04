import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const MODE = process.argv[2] ?? "off",
  PORT = process.argv[3] ?? "4173";
assert.ok(["off", "assets"].includes(MODE));
assert.match(PORT, /^\d{2,5}$/);
const ORIGIN = `http://127.0.0.1:${PORT}`;
let cookie = "";
async function call(path, method = "GET", body) {
  return fetch(ORIGIN + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const value = Buffer.alloc(data.length + 12);
  value.writeUInt32BE(data.length, 0);
  value.write(type, 4);
  value.set(data, 8);
  value.writeUInt32BE(
    crc(value.subarray(4, value.length - 4)),
    value.length - 4,
  );
  return value;
}
function image() {
  const width = 1024,
    height = 1024,
    header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      pixels[offset] = 30;
      pixels[offset + 1] = 100;
      pixels[offset + 2] = 180;
      pixels[offset + 3] = x < 512 ? 255 : 0;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function main() {
  const page = await call("/media");
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("Cache-Control"), "no-store");
  assert.match(await page.text(), /画像と素材/);
  assert.equal((await call("/api/media/assets")).status, 401);
  for (const path of [
    "/api/media-source",
    "/api/media-source/id",
    "/api/media-source/id?token=invalid",
  ])
    assert.equal((await call(path)).status, 404);
  const credentials = {
    email: "test-only-m2-gui@example.test",
    password: "TEST_ONLY_m2_gui_password",
  };
  let auth = await call("/api/auth/sign-up/email", "POST", {
    ...credentials,
    name: "TEST_ONLY M2",
  });
  if (!auth.ok)
    auth = await call("/api/auth/sign-in/email", "POST", credentials);
  assert.equal(auth.status, 200);
  cookie = auth.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const models = await call("/api/media/models");
  if (MODE === "off") {
    assert.equal(models.status, 404);
    assert.equal((await call("/api/media/assets", "POST", {})).status, 404);
  } else {
    assert.equal(models.status, 200);
    const catalog = await models.json();
    assert.equal(catalog.models.length, 4);
    assert.ok(catalog.models.every((model) => !model.isExecutable));
    const bytes = image(),
      reserved = await call("/api/media/assets", "POST", {
        bytes: bytes.length,
        contentType: "image/png",
      });
    assert.equal(reserved.status, 201);
    const reservation = await reserved.json();
    const uploaded = await fetch(ORIGIN + reservation.uploadPath, {
      method: "PUT",
      headers: { Origin: ORIGIN, Cookie: cookie, "Content-Type": "image/png" },
      body: bytes,
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(uploaded.status, 200);
    const asset = await uploaded.json();
    assert.equal(asset.canReference, true);
    assert.equal(asset.hasAlpha, true);
    const file = await call(`/api/media/assets/${asset.id}/file`);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    const head = await call(`/api/media/assets/${asset.id}/file`, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const badOrigin = await fetch(`${ORIGIN}/api/media/assets/${asset.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "https://foreign.example.invalid" },
    });
    assert.equal(badOrigin.status, 403);
    const generated = await call("/api/media/jobs", "POST", {
      requestId: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
      model: catalog.models[0].id,
      input: { prompt: "TEST_ONLY_do_not_call_provider" },
    });
    assert.equal(generated.status, 503);
    assert.equal((await call("/api/media/jobs")).status, 200);
    const path = ".wrangler/m2-validation-20261004";
    await writeFile(`${path}/reference.png`, bytes);
    await writeFile(
      `${path}/gui-assets.json`,
      JSON.stringify({ id: asset.id }),
    );
  }
  assert.equal((await call("/api/auth/sign-out", "POST", {})).status, 200);
  console.log(
    `PASS: M-2 ${MODE} preview SSR/auth/token rejection/owner/private boundary`,
  );
}
main().catch(() => {
  console.error("FAIL: M-2 local HTTP validation");
  process.exitCode = 1;
});
