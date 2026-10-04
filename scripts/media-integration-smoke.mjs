import assert from "node:assert/strict";

const PORT = process.argv[2] ?? "4197";
assert.match(PORT, /^\d{2,5}$/);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MODELS = [
  "openai/gpt-image-2.5/sunburst/text-to-image",
  "openai/gpt-image-2.5/sunburst/edit",
  "openai/gpt-image-2.5/flare/text-to-image",
  "openai/gpt-image-2.5/flare/edit",
  "minimax/h3-max/text-to-video",
  "minimax/h3-max/image-to-video",
  "minimax/h3-max/reference-to-video",
  "minimax/h3-max/camera-controls",
  "google/gemini-3.8-flash-tts",
  "google/gemini-3.8-flash-lite-tts",
  "elevenlabs/tts/eleven-v4",
  "elevenlabs/music/v2.5",
];
let cookie = "",
  stage = "startup";
const assets = [];
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
async function account() {
  const credentials = {
    name: "TEST_ONLY M5 HTTP",
    email: `m5-http-${crypto.randomUUID()}@example.test`,
    password: "TEST_ONLY_m5_http_password",
  };
  let response = await call("/api/auth/sign-up/email", "POST", credentials);
  for (let attempt = 0; response.status === 429 && attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25000));
    response = await call("/api/auth/sign-up/email", "POST", credentials);
  }
  assert.equal(response.status, 200);
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function clear() {
  for (const id of assets.splice(0)) {
    assert.equal((await call(`/api/media/assets/${id}`, "DELETE")).status, 200);
    assert.equal((await call(`/api/media/assets/${id}/file`)).status, 404);
  }
  assert.equal((await call("/api/auth/sign-out", "POST", {})).status, 200);
  cookie = "";
  assert.equal((await call("/api/media/assets")).status, 401);
}
async function generate(index, reference) {
  stage = `${MODELS[index]}:submit`;
  const input =
    index < 4
      ? {
          prompt: "TEST_ONLY image",
          size: { width: 1024, height: 1024 },
          quality: "xhigh",
          count: 1,
          format: "png",
          background: "opaque",
          ...(index % 2 ? { references: [reference] } : {}),
        }
      : index < 8
        ? {
            prompt: "TEST_ONLY video",
            duration: 5,
            resolution: "480P",
            ...(index === 4
              ? { aspectRatio: "1:1" }
              : index === 5
                ? { end: reference }
                : index === 6
                  ? {
                      references: [reference],
                      start: reference,
                      aspectRatio: "adaptive",
                    }
                  : {
                      start: reference,
                      keyframes: [
                        { time: 0, azimuth: 0, elevation: 0, distance: 1 },
                        { time: 1, azimuth: -90, elevation: 0, distance: 1 },
                      ],
                    }),
          }
        : index === 8
          ? { mode: "single", text: "TEST_ONLY speech", voice: "Kore" }
          : index === 9
            ? {
                mode: "dialogue",
                speakers: [
                  { alias: "A", voice: "Kore" },
                  { alias: "B", voice: "Puck" },
                ],
                turns: [
                  { alias: "B", text: "二" },
                  { alias: "A", text: "一" },
                ],
              }
            : index === 10
              ? {
                  text: "TEST_ONLY speech",
                  voice: "Aria",
                  language: "ja",
                  format: "mp3_44100_192",
                }
              : {
                  prompt: "TEST_ONLY music",
                  duration: 3,
                  instrumental: true,
                  format: "mp3_48000_192",
                };
  const raw = {
    model: MODELS[index],
    input,
    requestId: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
  };
  const submitted = await call("/api/media/jobs", "POST", raw);
  assert.equal(submitted.status, 202);
  const job = await submitted.json();
  assert.equal(
    (await (await call("/api/media/jobs", "POST", raw)).json()).id,
    job.id,
  );
  assert.equal(
    (await (await call(`/api/media/jobs/${job.id}`)).json()).providerState,
    "queued",
  );
  stage = `${MODELS[index]}:waiting`;
  await new Promise((resolve) => setTimeout(resolve, 5100));
  assert.equal(
    (await (await call(`/api/media/jobs/${job.id}/refresh`, "POST", {})).json())
      .providerState,
    "queued",
  );
  await new Promise((resolve) => setTimeout(resolve, 5100));
  stage = `${MODELS[index]}:collection`;
  const refresh = await call(`/api/media/jobs/${job.id}/refresh`, "POST", {});
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).terminalOutcome, "stored");
  const detail = await (await call(`/api/media/jobs/${job.id}`)).json();
  assert.ok(!JSON.stringify(detail).includes("fal.media"));
  const id = detail.assets[0].id;
  assets.push(id);
  const head = await call(
    `/api/media/assets/${id}/file`,
    "HEAD",
    undefined,
    index >= 4 ? { Range: "bytes=999999-" } : {},
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Cache-Control"), "private, no-store");
  assert.equal(
    head.headers.get("Content-Type"),
    index < 4
      ? "image/png"
      : index < 8
        ? "video/mp4"
        : index < 10
          ? "audio/wav"
          : "audio/mpeg",
  );
  if (index >= 4) {
    for (const range of ["bytes=0-31", "bytes=-32", "bytes=100-"]) {
      const response = await call(
        `/api/media/assets/${id}/file`,
        "GET",
        undefined,
        { Range: range, "If-Range": head.headers.get("ETag") },
      );
      assert.equal(response.status, 206);
      assert.equal(
        (await response.arrayBuffer()).byteLength,
        Number(response.headers.get("Content-Length")),
      );
    }
    assert.equal(
      (
        await call(`/api/media/assets/${id}/file`, "GET", undefined, {
          Range: "bytes=999999999-",
        })
      ).status,
      416,
    );
    const mismatch = await call(
      `/api/media/assets/${id}/file`,
      "GET",
      undefined,
      { Range: "bytes=0-31", "If-Range": '"TEST_ONLY_other"' },
    );
    assert.equal(mismatch.status, 200);
    await mismatch.body.cancel();
  }
  console.log(
    `PASS: ${MODELS[index]} / shared API / private output / replay / Range`,
  );
  return id;
}
async function main() {
  // 元DBや通常previewへの誤実行を止める。通信はWorker内の固定fakeだけ。
  assert.deepEqual(await (await call("/__m5-fixture")).json(), {
    isSynthetic: true,
    endpointCount: 12,
  });
  assert.equal((await call("/media")).status, 200);
  assert.equal((await call("/api/media/assets")).status, 401);
  await account();
  const models = await (await call("/api/media/models")).json();
  assert.deepEqual(
    models.models.map((model) => model.id),
    MODELS,
  );
  assert.equal(models.models.filter((model) => model.isExecutable).length, 12);
  const reference = await generate(0);
  const before = await (await call(`/api/media/assets/${reference}`)).json();
  for (let index = 1; index < 7; index++) await generate(index, reference);
  assert.deepEqual(
    await (await call(`/api/media/assets/${reference}`)).json(),
    before,
  );
  await clear();
  // 1所有者の動画3要求枠を変更せず、4件目は別の合成所有者で検査。
  await account();
  const cameraReference = await generate(0);
  for (let index = 7; index < 12; index++)
    await generate(index, cameraReference);
  await clear();
  console.log(
    "PASS: M-5 twelve endpoints / generated image reuse / expiry unchanged / physical deletion / logout",
  );
}
main().catch(() => {
  console.error(`FAIL: M-5 isolated synthetic HTTP (${stage})`);
  process.exitCode = 1;
});
