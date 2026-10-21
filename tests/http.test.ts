import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiError,
  errorResponse,
  readJson,
  requireMethod,
  requireSameOrigin,
} from "../src/server/http";

const ORIGIN = "https://app.example.test";
const schema = z.object({ message: z.string() }).strict();
const post = (body: BodyInit, headers: HeadersInit = {}) =>
  new Request(`${ORIGIN}/api/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
const rejection = (status: number, code: string) =>
  expect.objectContaining({ status, code });

describe("readJson", () => {
  it("accepts a charset parameter and returns the parsed value", async () => {
    const request = post('{"message":"ok"}', {
      "Content-Type": "Application/JSON; charset=utf-8",
    });
    await expect(readJson(request, schema)).resolves.toEqual({
      message: "ok",
    });
  });
  it("rejects a missing or different content type", async () => {
    await expect(
      readJson(post("{}", { "Content-Type": "text/plain" }), schema),
    ).rejects.toEqual(rejection(415, "unsupported_media_type"));
    const bare = new Request(`${ORIGIN}/api/test`, {
      method: "POST",
      body: "{}",
    });
    bare.headers.delete("Content-Type");
    await expect(readJson(bare, schema)).rejects.toEqual(
      rejection(415, "unsupported_media_type"),
    );
  });
  it("stops reading once the body exceeds the byte limit", async () => {
    const body = JSON.stringify({ message: "x".repeat(64) });
    await expect(readJson(post(body), schema, 32)).rejects.toEqual(
      rejection(413, "payload_too_large"),
    );
    await expect(
      readJson(post(body), schema, body.length),
    ).resolves.toMatchObject({ message: "x".repeat(64) });
  });
  it("separates broken JSON from schema mismatches", async () => {
    await expect(readJson(post("{"), schema)).rejects.toEqual(
      rejection(400, "invalid_json"),
    );
    await expect(
      readJson(post('{"message":"ok","extra":1}'), schema),
    ).rejects.toEqual(rejection(400, "invalid_input"));
  });
  it("rejects invalid UTF-8 only in strict mode", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('{"message":"'),
      0xff,
      ...new TextEncoder().encode('"}'),
    ]);
    await expect(readJson(post(bytes), schema)).resolves.toEqual({
      message: "�",
    });
    await expect(readJson(post(bytes), schema, 32768, true)).rejects.toEqual(
      rejection(400, "invalid_json"),
    );
  });
});

describe("requireMethod and requireSameOrigin", () => {
  it("rejects methods outside the allowed list", () => {
    const request = new Request(`${ORIGIN}/api/test`, { method: "PUT" });
    expect(() => requireMethod(request, ["GET", "POST"])).toThrow(
      expect.objectContaining({ status: 405, code: "method_not_allowed" }),
    );
    expect(() => requireMethod(request, ["PUT"])).not.toThrow();
  });
  it("skips safe methods and requires the same origin for writes", () => {
    expect(() =>
      requireSameOrigin(new Request(`${ORIGIN}/api/test`)),
    ).not.toThrow();
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { Origin: "https://other.example.test" },
      { Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      expect(() =>
        requireSameOrigin(
          new Request(`${ORIGIN}/api/test`, { method: "POST", headers }),
        ),
      ).toThrow(
        expect.objectContaining({ status: 403, code: "origin_not_allowed" }),
      );
    }
    expect(() =>
      requireSameOrigin(
        new Request(`${ORIGIN}/api/test`, {
          method: "POST",
          headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
        }),
      ),
    ).not.toThrow();
  });
});

describe("errorResponse", () => {
  it("returns the fixed code of an ApiError", async () => {
    const response = errorResponse(new ApiError(409, "conversation_busy"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conversation_busy" });
  });
  it("hides unexpected error details behind internal_error", async () => {
    const response = errorResponse(new Error("TEST_ONLY_secret_detail"));
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "internal_error" });
    expect(text).not.toContain("TEST_ONLY_secret_detail");
  });
});
