import assert from "node:assert/strict";

const PORT = process.argv[2] ?? "4196";
assert.match(PORT, /^\d{2,5}$/);
const ORIGIN = `http://127.0.0.1:${PORT}`;
assert.deepEqual(await (await fetch(`${ORIGIN}/__m4-fixture`)).json(), {
  isSynthetic: true,
});
let cookie = "",
  stage = "startup";
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
  assert.equal((await call("/media")).status, 200);
  assert.equal((await call("/api/media/assets")).status, 401);
  const auth = await call("/api/auth/sign-up/email", "POST", {
    name: "TEST_ONLY M4 HTTP",
    email: `test-only-m4-${crypto.randomUUID()}@example.test`,
    password: "TEST_ONLY_m4_http_password",
  });
  assert.equal(auth.status, 200);
  cookie = auth.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const models = await (await call("/api/media/models")).json();
  assert.equal(models.models.length, 12);
  assert.equal(models.models.filter((model) => model.isExecutable).length, 4);
  for (const [model, input, mime] of [
    [
      "google/gemini-3.8-flash-tts",
      { mode: "single", text: "TEST_ONLY speech", instruction: "穏やかに" },
      "audio/wav",
    ],
    [
      "google/gemini-3.8-flash-lite-tts",
      {
        mode: "dialogue",
        speakers: [
          { alias: "A", voice: "Kore" },
          { alias: "B", voice: "Puck" },
        ],
        turns: [
          { alias: "B", text: "二" },
          { alias: "A", text: "一" },
        ],
      },
      "audio/wav",
    ],
    [
      "elevenlabs/tts/eleven-v4",
      {
        text: "TEST_ONLY speech",
        voice: "Aria",
        language: "ja",
        format: "mp3_44100_192",
      },
      "audio/mpeg",
    ],
    [
      "elevenlabs/music/v2.5",
      {
        prompt: "TEST_ONLY music",
        duration: 3,
        instrumental: true,
        format: "mp3_48000_192",
      },
      "audio/mpeg",
    ],
  ]) {
    stage = `${model}:submit`;
    const raw = {
      requestId: `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`,
      model,
      input,
    };
    const submission = await call("/api/media/jobs", "POST", raw);
    assert.equal(submission.status, 202);
    const job = await submission.json();
    assert.equal(
      (await (await call("/api/media/jobs", "POST", raw)).json()).id,
      job.id,
    );
    assert.equal(
      (await (await call(`/api/media/jobs/${job.id}`)).json()).providerState,
      "queued",
    );
    await new Promise((resolve) => setTimeout(resolve, 5100));
    stage = `${model}:waiting`;
    assert.equal(
      (
        await (
          await call(`/api/media/jobs/${job.id}/refresh`, "POST", {})
        ).json()
      ).providerState,
      "queued",
    );
    await new Promise((resolve) => setTimeout(resolve, 5100));
    stage = `${model}:collection`;
    const refreshed = await call(
      `/api/media/jobs/${job.id}/refresh`,
      "POST",
      {},
    );
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).terminalOutcome, "stored");
    const detail = await (await call(`/api/media/jobs/${job.id}`)).json(),
      id = detail.assets[0].id;
    assert.ok(!JSON.stringify(detail).includes("fal.media"));
    const head = await call(`/api/media/assets/${id}/file`, "HEAD", undefined, {
      Range: "bytes=999999-",
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("Content-Type"), mime);
    assert.equal(head.headers.get("Cache-Control"), "private, no-store");
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
          Range: "bytes=999999-",
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
    assert.equal((await call(`/api/media/assets/${id}`, "DELETE")).status, 200);
    assert.equal((await call(`/api/media/assets/${id}/file`)).status, 404);
    console.log(
      `PASS: ${model} synthetic preview / reload / private audio / Range / deletion`,
    );
  }
  stage = "logout";
  assert.equal((await call("/api/auth/sign-out", "POST", {})).status, 200);
  cookie = "";
  assert.equal((await call("/api/media/assets")).status, 401);
}
main().catch(() => {
  console.error(`FAIL: M-4 isolated synthetic preview HTTP (${stage})`);
  process.exitCode = 1;
});
