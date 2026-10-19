import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
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

  const env = {
    APP_ENV: "local",
    APP_ORIGIN: "http://127.0.0.1:3000",
    LOCAL_DEMO: "false",
    ENABLE_BILLING: "true",
    POLAR_ACCESS_TOKEN: "fixture-only-api-token",
  } as AppEnv;
  const checkoutInput = {
    ownerId: "better-auth:fixture",
    productId: "00000000-0000-4000-8000-000000000001",
    operationId: "fixture-op",
    returnUrl: "https://example.test/app",
  };

  it("maps snake_case checkout and portal responses", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          id: "checkout-fixture",
          url: "https://sandbox.polar.sh/checkout/fixture",
          expires_at: "2030-01-01T00:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          customer_portal_url: "https://sandbox.polar.sh/portal/fixture",
        }),
      );
    const provider = createPolarProvider(env);
    await expect(provider.checkout(checkoutInput)).resolves.toEqual({
      id: "checkout-fixture",
      url: "https://sandbox.polar.sh/checkout/fixture",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
    await expect(
      provider.portal({
        ownerId: "better-auth:fixture",
        returnUrl: "https://example.test/app",
      }),
    ).resolves.toEqual({ url: "https://sandbox.polar.sh/portal/fixture" });
    const portalRequest = new Request(...fetchMock.mock.calls[1]);
    expect(await portalRequest.json()).toEqual({
      external_customer_id: "better-auth:fixture",
      return_url: "https://example.test/app",
    });
  });

  it.each([
    { url: "https://sandbox.polar.sh/checkout/fixture" },
    { id: "checkout-fixture", expires_at: "2030-01-01T00:00:00Z" },
    {
      id: "checkout-fixture",
      url: "https://sandbox.polar.sh/checkout/fixture",
      expires_at: "not-a-date",
    },
  ])(
    "rejects a checkout response with missing or invalid fields (%o)",
    async (response) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(Response.json(response));
      await expect(
        createPolarProvider(env).checkout(checkoutInput),
      ).rejects.toBeInstanceOf(ZodError);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
});
