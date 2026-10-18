import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://starter.test";

describe("Worker API boundary", () => {
  it("returns health JSON without caching", async () => {
    const response = await exports.default.fetch(`${origin}/api/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      runtime: "cloudflare-workers",
    });
  });

  it("supports HEAD without a body", async () => {
    const response = await exports.default.fetch(`${origin}/api/health`, {
      method: "HEAD",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it.each([
    ["/api/health", "POST", "GET, HEAD"],
    ["/api/validate", "GET", "POST"],
  ])("rejects incorrect methods on %s", async (path, method, allow) => {
    const response = await exports.default.fetch(`${origin}${path}`, {
      method,
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe(allow);
  });

  it.each([
    "/api",
    "/api/missing",
    "/api/health/other",
    "/api/ai-verification",
    "/api/ai-verification/other",
    "/api/ai-verification-extra",
  ])("returns JSON 404 for %s", async (path) => {
    const response = await exports.default.fetch(`${origin}${path}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("validates JSON and does not echo input", async () => {
    const response = await post(JSON.stringify({ message: "  確認  " }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true, length: 2 });
  });

  it.each([
    "{",
    "",
    "null",
    "[]",
    JSON.stringify({ message: " " }),
    JSON.stringify({ message: 123 }),
    JSON.stringify({ message: "a".repeat(201) }),
    JSON.stringify({ message: "ok", extra: "unexpected" }),
  ])("rejects malformed or invalid payload %#", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects non-JSON content", async () => {
    const response = await exports.default.fetch(`${origin}/api/validate`, {
      method: "POST",
      body: "message=hello",
      headers: { "Content-Type": "text/plain" },
    });
    expect(response.status).toBe(415);
  });

  it("enforces a byte limit even without Content-Length", async () => {
    const response = await post(JSON.stringify({ message: "あ".repeat(1000) }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });
});

function post(body: string) {
  return exports.default.fetch(`${origin}/api/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body,
  });
}
