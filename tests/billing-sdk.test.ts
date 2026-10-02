import { afterEach, describe, expect, it, vi } from "vitest";
import { createPolarProvider } from "../src/server/billing";
import type { AppEnv } from "../src/server/env";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Installed Polar SDK transport boundary", () => {
  it.each([undefined, "sandbox", "production"] as const)(
    "uses explicit environment, fixed checkout fields and no retry (%s)",
    async (server) => {
      let body: Record<string, unknown> = {};
      let target = "";
      let hasTimeout = false;
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          const req = new Request(input, init);
          target = new URL(req.url).origin;
          hasTimeout = !!req.signal;
          body = (await req.json()) as Record<string, unknown>;
          throw new DOMException("fixture-timeout", "TimeoutError");
        });
      const provider = createPolarProvider({
        APP_ENV: "local",
        APP_ORIGIN: "http://127.0.0.1:3000",
        LOCAL_DEMO: "false",
        ENABLE_BILLING: "true",
        POLAR_ACCESS_TOKEN: "fixture-only-api-token",
        POLAR_SERVER: server,
      } as AppEnv);
      let failed = false;
      try {
        await provider.checkout({
          ownerId: "better-auth:fixture",
          productId: "00000000-0000-4000-8000-000000000001",
          operationId: "fixture-op",
          returnUrl: "https://example.test/app",
        });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(target).toBe(
        server === "production"
          ? "https://api.polar.sh"
          : "https://sandbox-api.polar.sh",
      );
      expect(hasTimeout).toBe(true);
      expect(body.external_customer_id).toBe("better-auth:fixture");
      expect(body.products).toEqual(["00000000-0000-4000-8000-000000000001"]);
      expect(body.metadata).toEqual({
        owner_id: "better-auth:fixture",
        operation_id: "fixture-op",
      });
      expect(body.success_url).toBe("https://example.test/app");
      expect(body.return_url).toBe("https://example.test/app");
    },
  );
});
