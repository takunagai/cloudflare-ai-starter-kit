import assert from "node:assert/strict";

// ローカル固定応答のみ。実Secretも実モデルも使わない。
const port = process.argv[2] ?? "4173";
assert.match(port, /^\d{2,5}$/);
const origin = `http://127.0.0.1:${port}`;
let cookie = "";
async function call(path, body, method = body === undefined ? "GET" : "POST") {
  return fetch(`${origin}${path}`, {
    method,
    redirect: "error",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
}
const session = await call("/api/session");
assert.equal(session.status, 200, "local session endpoint");
const config = await session.json();
assert.equal(config.localDemo, true, "refuse non-demo environment");
const anonymousDecision = await call("/api/decisions/classify", {});
assert.equal(anonymousDecision.status, 404, "Jev is OFF before authentication");
assert.deepEqual(await anonymousDecision.json(), {
  error: "decision_disabled",
});
assert.equal(
  config.authMode,
  "better-auth",
  "core smoke requires local Better Auth",
);
assert.equal(
  Object.values(config.features).every((value) => value === false),
  true,
  "core smoke requires every optional feature OFF",
);
const anonymousVerification = await call("/api/ai-verification");
assert.equal(
  anonymousVerification.status,
  401,
  "verification requires authentication through the Worker entry",
);
const app = await call("/app");
assert.equal(app.status, 200);
assert.equal(app.headers.get("Referrer-Policy"), "no-referrer");
assert.equal(app.headers.get("Cache-Control"), "no-store");
assert.match(await app.text(), /noindex/);
const registered = await call("/api/auth/sign-up/email", {
  name: "HTTP検証",
  email: `smoke-${crypto.randomUUID()}@example.test`,
  password: "TEST_ONLY_local_signup_password",
});
assert.equal(registered.status, 200, "local dummy signup");
cookie = registered.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
assert.equal(Boolean(cookie), true, "session created");
const decisionKey = `${new Date().toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
const decisionStatus = await call(`/api/decisions/requests/${decisionKey}`);
assert.equal(
  decisionStatus.status,
  404,
  "Jev metadata route reachable while OFF",
);
assert.equal(decisionStatus.headers.get("Cache-Control"), "private, no-store");
const listedModels = await call("/api/models");
assert.equal(listedModels.status, 200, "authenticated model catalog");
assert.equal(listedModels.headers.get("Cache-Control"), "no-store");
const { models } = await listedModels.json();
assert.deepEqual(
  models.filter((model) => model.available).map((model) => model.id),
  ["local/demo"],
  "B-2 local compatibility allows only the fixed demo model",
);
const verification = await call("/api/ai-verification");
assert.equal(
  verification.status,
  200,
  "verification status reachable through the built Worker",
);
assert.deepEqual(await verification.json(), { ready: false, remaining: 0 });
const created = await call("/api/conversations", { title: "HTTP smoke" });
assert.equal(created.status, 201);
const { conversation } = await created.json();
const body = {
  conversationId: conversation.id,
  requestId: crypto.randomUUID(),
  modelId: "local/demo",
  message: "ローカル統合確認",
};
const generated = await call("/api/chat", body);
assert.equal(generated.status, 200);
const sse = await generated.text();
assert.equal(sse.includes('"type":"finish"'), true, "stream completed");
assert.equal(sse.includes("AI未使用"), true, "fixed demo model");
const replay = await call("/api/chat", body);
assert.equal((await replay.json()).replayed, true, "idempotent replay");
const history = await call(`/api/conversations/${conversation.id}`);
const data = await history.json();
assert.equal(data.messages.length, 2);
assert.equal(
  data.messages.every((message) => message.status === "complete"),
  true,
);
for (const path of [
  "/api/extensions/rag/documents",
  "/api/extensions/images",
  "/api/extensions/workflows",
  "/api/billing/status",
  "/api/approvals",
]) {
  assert.equal((await call(path)).status, 404, "optional feature disabled");
}
assert.equal(
  (await call(`/api/conversations/${conversation.id}`, {}, "DELETE")).status,
  200,
);
assert.equal((await call("/api/auth/sign-out", {})).status, 200);
assert.equal((await call("/api/models")).status, 401, "revoked session");
cookie = "";
console.log(
  "PASS: local app smoke, Jev OFF and metadata route / all extensions OFF / signup / chat / history / replay / delete / logout",
);
