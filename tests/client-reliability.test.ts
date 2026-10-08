import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/components/api-client";
import {
  forgetRequest,
  pendingRequest,
  rememberRequest,
} from "../src/components/request-recovery";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("通信結果と再読込用の要求記録", () => {
  it("通信断を不明に分類し自動再送しない", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("private network detail");
    });
    vi.stubGlobal("fetch", fetch);
    await expect(api("/api/example", { value: "架空" })).rejects.toMatchObject({
      code: "network_unconfirmed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 200])(
    "認証拒否とHTML応答を成功扱いしない: %s",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("private login HTML", {
              status,
              headers: { "Content-Type": "text/html" },
            }),
        ),
      );
      await expect(api("/api/example")).rejects.toMatchObject({
        code:
          status === 401 ? "authentication_required" : "unexpected_response",
      });
    },
  );
  it("再読込後に要求IDだけを復元し、本文・出典をブラウザ保存へ追加しない", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    const request = {
      requestId: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
    };
    rememberRequest("fake-owner", request);
    expect(pendingRequest("fake-owner")).toEqual(request);
    expect(pendingRequest("other-owner")).toBeNull();
    expect(Object.keys(JSON.parse([...values.values()][0]))).toEqual([
      "requestId",
      "conversationId",
    ]);
    forgetRequest("fake-owner", crypto.randomUUID());
    expect(pendingRequest("fake-owner")).toEqual(request);
    forgetRequest("fake-owner", request.requestId);
    expect(pendingRequest("fake-owner")).toBeNull();
  });
  it("ブラウザ保存の拒否時は記録なしで送信を進めない", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("denied");
      },
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(() =>
      rememberRequest("fake-owner", {
        requestId: crypto.randomUUID(),
        conversationId: crypto.randomUUID(),
      }),
    ).toThrow("local_recovery_unavailable");
    expect(() => pendingRequest("fake-owner")).toThrow(
      "local_recovery_unavailable",
    );
  });
});
