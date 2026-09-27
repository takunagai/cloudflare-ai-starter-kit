import assert from "node:assert/strict";

// ローカルdev/preview専用。外部URLへリクエストを送らない。
const port = process.argv[2] ?? "4173";
assert.match(port, /^\d{2,5}$/);
const base = `http://127.0.0.1:${port}`;
async function get(path, init) {
  return fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10000),
  });
}

const home = await get("/");
assert.equal(home.status, 200);
assert.match(home.headers.get("content-type") ?? "", /text\/html/);
const html = await home.text();
assert.match(html, /次のアプリを/);
assert.match(html, /lang="ja"/);
assert.match(html, /name="description"/);
assert.match(html, /接続を確認する/);

const help = await get("/help");
assert.equal(help.status, 200);
assert.match(await help.text(), /小さく始めるための土台/);
const missing = await get("/not-a-page");
assert.equal(missing.status, 404);
const apiMissing = await get("/api/missing");
assert.equal(apiMissing.status, 404);
assert.deepEqual(await apiMissing.json(), { error: "not_found" });
const health = await get("/api/health");
assert.equal(health.headers.get("cache-control"), "no-store");
assert.deepEqual(await health.json(), {
  status: "ok",
  runtime: "cloudflare-workers",
});
const valid = await get("/api/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "準備完了" }),
});
assert.equal(valid.status, 200);
assert.deepEqual(await valid.json(), { valid: true, length: 4 });

// ビルド済みアセットの配信も確認。HTML fallbackでは合格しない。
const cssPath = html.match(/href="([^"<>]+\.css(?:\?[^"<>]*)?)"/)?.[1];
assert.ok(cssPath, "stylesheet link must exist");
const cssUrl = new URL(cssPath, base);
assert.equal(cssUrl.origin, base);
const css = await get(cssUrl.pathname + cssUrl.search, {
  headers: { Accept: "text/css" },
});
assert.equal(css.status, 200);
assert.match(css.headers.get("content-type") ?? "", /text\/css/);
const modulePaths = [
  ...html.matchAll(/<script[^>]+src="([^"<>]+)"[^>]*>/g),
].map((match) => match[1]);
assert.ok(modulePaths.length > 0, "client script must exist");
for (const path of new Set(modulePaths)) {
  const url = new URL(path, base);
  assert.equal(url.origin, base);
  const response = await get(url.pathname + url.search);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /(?:java|ecma)script/,
  );
}
console.log(
  `PASS: local HTTP smoke (${port}), SSR HTML / help / 404 / API / CSS / client JS`,
);

await import("./app-smoke.mjs");
