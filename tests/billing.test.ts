import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { Webhook } from "standardwebhooks";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type BillingProvider,
  createBillingHandler,
  createPolarProvider,
} from "../src/server/billing";
import type { AppEnv, Identity } from "../src/server/env";

const secret = `whsec_${Buffer.from("only-test-fixture-signing-key-2026").toString("base64")}`;
const config: AppEnv = {
  ...env,
  APP_ENV: "local",
  APP_ORIGIN: "http://127.0.0.1:3000",
  AUTH_MODE: "better-auth",
  ENABLE_BILLING: "true",
  POLAR_PRODUCT_ID: "test-product",
  POLAR_WEBHOOK_SECRET: secret,
} as AppEnv;
const alice: Identity = {
  id: "better-auth:alice",
  email: "alice@example.test",
  name: "Alice",
};
const bob: Identity = {
  id: "access:example.cloudflareaccess.com:bob",
  email: "bob@example.test",
  name: "Bob",
};
const calls: Parameters<BillingProvider["checkout"]>[0][] = [];
const portals: Parameters<BillingProvider["portal"]>[0][] = [];
const provider: BillingProvider = {
  async checkout(input) {
    calls.push(input);
    return {
      id: "checkout-fixture",
      url: "https://sandbox.polar.sh/checkout/test",
      expiresAt: new Date(Date.now() + 600_000),
    };
  },
  async portal(input) {
    portals.push(input);
    return { url: "https://sandbox.polar.sh/portal/test" };
  },
};
const handle = createBillingHandler(() => provider);
function api(path: string, body?: unknown) {
  return new Request(`${config.APP_ORIGIN}/api/billing/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: config.APP_ORIGIN, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function signed(
  event: unknown,
  eventId = crypto.randomUUID(),
  legacy = false,
  timestamp = new Date(),
) {
  const body = JSON.stringify(event);
  const signer = new Webhook(
    legacy ? Buffer.from(secret).toString("base64") : secret,
  );
  return new Request(`${config.APP_ORIGIN}/api/billing/webhook`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/json",
      "webhook-id": eventId,
      "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "webhook-signature": signer.sign(eventId, timestamp, body),
    },
  });
}
function state(
  owner = alice.id,
  active = true,
  time = Date.now(),
  customer = "customer-alice",
) {
  return {
    type: "customer.state_changed",
    timestamp: new Date(time).toISOString(),
    data: {
      id: customer,
      external_id: owner,
      active_subscriptions: active
        ? [
            {
              id: "subscription-fixture",
              product_id: config.POLAR_PRODUCT_ID,
              status: "active",
              current_period_end: new Date(
                Date.now() + 86_400_000,
              ).toISOString(),
              cancel_at_period_end: false,
            },
          ]
        : [],
    },
  };
}
async function seed(identity = alice) {
  expect((await handle(api("checkout", {}), config, identity))?.status).toBe(
    200,
  );
}

function checkoutState(operation: string, status: string, time: number) {
  return {
    type: "checkout.updated",
    timestamp: new Date(time).toISOString(),
    data: {
      id: "checkout-fixture",
      external_customer_id: alice.id,
      product_id: config.POLAR_PRODUCT_ID,
      metadata: { owner_id: alice.id, operation_id: operation },
      status,
      url: "https://sandbox.polar.sh/checkout/test",
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    },
  };
}

async function checkoutOperation() {
  const row = await config.DB.prepare(
    "SELECT operation_id FROM billing_checkouts WHERE owner_id = ?",
  )
    .bind(alice.id)
    .first<{ operation_id: string }>();
  if (!row) throw new Error("TEST_RESERVATION_MISSING");
  return row.operation_id;
}

beforeEach(async () => {
  calls.length = 0;
  portals.length = 0;
  await config.DB.batch(
    [
      "billing_subscriptions",
      "billing_checkouts",
      "billing_customers",
      "billing_events",
    ].map((name) => config.DB.prepare(`DELETE FROM ${name}`)),
  );
});

describe("Polar checkout and owner boundary on D1", () => {
  it("requires no billing configuration when disabled and rejects unauthenticated callers", async () => {
    expect(
      (
        await handle(
          api("status"),
          { ...config, ENABLE_BILLING: "false", POLAR_PRODUCT_ID: undefined },
          null,
        )
      )?.status,
    ).toBe(404);
    expect((await handle(api("checkout", {}), config, null))?.status).toBe(401);
    expect(() => createPolarProvider(config)).toThrow("billing_not_configured");
    expect(
      await handle(
        new Request(`${config.APP_ORIGIN}/api/other`),
        config,
        alice,
      ),
    ).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("fixes owner, product, metadata and redirect server-side and reuses checkout", async () => {
    await seed();
    expect((await handle(api("checkout", {}), config, alice))?.status).toBe(
      200,
    );
    expect(calls.length).toBe(1);
    expect(calls[0].ownerId).toBe(alice.id);
    expect(calls[0].productId).toBe(config.POLAR_PRODUCT_ID);
    expect(calls[0].returnUrl).toBe(`${config.APP_ORIGIN}/app`);
    expect(
      (
        await handle(
          api("checkout", {
            externalCustomerId: bob.id,
            returnUrl: "https://evil.test",
          }),
          config,
          alice,
        )
      )?.status,
    ).toBe(400);
    const crossOrigin = api("checkout", {});
    crossOrigin.headers.set("Origin", "https://evil.test");
    expect((await handle(crossOrigin, config, alice))?.status).toBe(403);
  });

  it("atomically suppresses concurrent checkout creation", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    const concurrent = createBillingHandler(() => ({
      ...provider,
      async checkout(input) {
        count++;
        await gate;
        return provider.checkout(input);
      },
    }));
    const first = concurrent(api("checkout", {}), config, alice);
    // D1の予約が存在するまで待ち、2番目の要求と実upstream処理を重ねる。
    for (let i = 0; i < 100; i++) {
      if (
        await config.DB.prepare(
          "SELECT 1 AS present FROM billing_checkouts",
        ).first()
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const second = await concurrent(api("checkout", {}), config, alice);
    expect(second?.status).toBe(409);
    release?.();
    expect((await first)?.status).toBe(200);
    expect(count).toBe(1);
  });

  it("does not repeat an uncertain upstream write, and recovers from a signed checkout event", async () => {
    let count = 0;
    const failing = createBillingHandler(() => ({
      ...provider,
      async checkout() {
        count++;
        throw new DOMException("test-timeout", "TimeoutError");
      },
    }));
    expect((await failing(api("checkout", {}), config, alice))?.status).toBe(
      502,
    );
    expect((await failing(api("checkout", {}), config, alice))?.status).toBe(
      409,
    );
    expect(count).toBe(1);
    const row = await config.DB.prepare(
      "SELECT operation_id FROM billing_checkouts WHERE owner_id = ?",
    )
      .bind(alice.id)
      .first<{ operation_id: string }>();
    const event = {
      type: "checkout.created",
      timestamp: new Date().toISOString(),
      data: {
        id: "recovered-checkout",
        external_customer_id: alice.id,
        product_id: config.POLAR_PRODUCT_ID,
        metadata: { owner_id: alice.id, operation_id: row?.operation_id },
        status: "open",
        url: "https://sandbox.polar.sh/checkout/recovered",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    };
    expect((await failing(signed(event), config, null))?.status).toBe(200);
    const retry = await failing(api("checkout", {}), config, alice);
    expect(retry?.status).toBe(200);
    expect(count).toBe(1);
    expect(await (await handle(api("status"), config, alice))?.json()).toEqual({
      subscription: null,
    });
  });

  it("rejects provider URLs outside the selected Polar environment", async () => {
    const invalid = createBillingHandler(() => ({
      ...provider,
      async checkout() {
        return {
          id: "fake",
          url: "https://evil.test",
          expiresAt: new Date(Date.now() + 1000),
        };
      },
    }));
    expect((await invalid(api("checkout", {}), config, alice))?.status).toBe(
      502,
    );
    expect((await invalid(api("checkout", {}), config, alice))?.status).toBe(
      409,
    );
  });

  it("only creates a portal for the verified owner mapping and keeps return URL fixed", async () => {
    expect((await handle(api("portal", {}), config, bob))?.status).toBe(409);
    await seed();
    await handle(signed(state()), config, null);
    expect((await handle(api("portal", {}), config, alice))?.status).toBe(200);
    expect(portals).toEqual([
      { ownerId: alice.id, returnUrl: `${config.APP_ORIGIN}/app` },
    ]);
    expect((await handle(api("portal", {}), config, bob))?.status).toBe(409);
  });

  it("requires a signed inactive snapshot at least as new as checkout completion before repurchase", async () => {
    await seed();
    const operation = await checkoutOperation();
    const completed = Date.now();
    await handle(
      signed(checkoutState(operation, "succeeded", completed)),
      config,
      null,
    );
    expect((await handle(api("checkout", {}), config, alice))?.status).toBe(
      409,
    );
    await handle(
      signed(state(alice.id, false, completed - 1000)),
      config,
      null,
    );
    expect((await handle(api("checkout", {}), config, alice))?.status).toBe(
      409,
    );
    await handle(signed(state(alice.id, false, completed)), config, null);
    expect((await handle(api("checkout", {}), config, alice))?.status).toBe(
      200,
    );
    expect(calls).toHaveLength(2);
    expect(await checkoutOperation()).not.toBe(operation);
  });

  it("reserves only one repurchase and ignores late events belonging to the old checkout", async () => {
    await seed();
    const oldOperation = await checkoutOperation();
    const completed = Date.now();
    await handle(
      signed(checkoutState(oldOperation, "succeeded", completed)),
      config,
      null,
    );
    await handle(
      signed(state(alice.id, false, completed + 1000)),
      config,
      null,
    );
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const concurrent = createBillingHandler(() => ({
      ...provider,
      async checkout(input) {
        entered?.();
        await gate;
        return provider.checkout(input);
      },
    }));
    const first = concurrent(api("checkout", {}), config, alice);
    await called;
    const newOperation = await checkoutOperation();
    expect(newOperation).not.toBe(oldOperation);
    expect((await concurrent(api("checkout", {}), config, alice))?.status).toBe(
      409,
    );
    for (const status of ["open", "expired", "succeeded"]) {
      expect(
        (
          await handle(
            signed(checkoutState(oldOperation, status, completed + 2000)),
            config,
            null,
          )
        )?.status,
      ).toBe(200);
    }
    const pending = await config.DB.prepare(
      "SELECT state FROM billing_checkouts WHERE operation_id = ?",
    )
      .bind(newOperation)
      .first<{ state: string }>();
    expect(pending?.state).toBe("pending");
    release?.();
    expect((await first)?.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect((await handle(api("checkout", {}), config, alice))?.status).toBe(
      200,
    );
    expect(calls).toHaveLength(2);
  });

  it("does not close a checkout using an older expired event", async () => {
    await seed();
    const operation = await checkoutOperation();
    const now = Date.now();
    await handle(signed(checkoutState(operation, "open", now)), config, null);
    await handle(
      signed(checkoutState(operation, "expired", now - 1000)),
      config,
      null,
    );
    expect((await handle(api("checkout", {}), config, alice))?.status).toBe(
      200,
    );
    expect(await checkoutOperation()).toBe(operation);
    expect(calls).toHaveLength(1);
  });
});

describe("Polar signed webhook persistence", () => {
  it.each(["active", "trialing"])(
    "serves the member sample only for the signed %s owner/product/server",
    async (status) => {
      expect((await handle(api("member"), config, alice))?.status).toBe(403);
      expect((await handle(api("member"), config, null))?.status).toBe(401);
      await seed();
      // Checkout creation itself never grants access.
      expect((await handle(api("member"), config, alice))?.status).toBe(403);
      const event = state();
      event.data.active_subscriptions[0].status = status;
      expect((await handle(signed(event), config, null))?.status).toBe(200);
      const allowed = await handle(api("member"), config, alice);
      expect(allowed?.status).toBe(200);
      expect(await allowed?.json()).toEqual({
        message: "有効な契約を確認しました。会員向け機能を利用できます。",
      });
      expect((await handle(api("member"), config, bob))?.status).toBe(403);
      expect(
        (
          await handle(
            api("member"),
            { ...config, POLAR_PRODUCT_ID: "other-product" },
            alice,
          )
        )?.status,
      ).toBe(403);
      expect(
        (
          await handle(
            api("member"),
            { ...config, POLAR_SERVER: "production" },
            alice,
          )
        )?.status,
      ).toBe(403);
      expect((await handle(api("member", {}), config, alice))?.status).toBe(
        405,
      );
    },
  );

  it("rejects expired and inactive signed subscriptions at the member API", async () => {
    await seed();
    const now = Date.now();
    const expired = state(alice.id, true, now);
    expired.data.active_subscriptions[0].current_period_end = new Date(
      now - 1000,
    ).toISOString();
    expect((await handle(signed(expired), config, null))?.status).toBe(200);
    for (const request of [api("member"), api("member?status=active")]) {
      const denied = await handle(request, config, alice);
      expect(denied?.status).toBe(403);
      expect(await denied?.json()).toMatchObject({
        error: "subscription_required",
      });
    }
    await handle(signed(state(alice.id, false, now + 1000)), config, null);
    expect((await handle(api("member"), config, alice))?.status).toBe(403);
  });

  it.each([false, true])(
    "supports Standard Webhooks and legacy Polar HMAC (legacy=%s)",
    async (legacy) => {
      await seed();
      const response = await handle(
        signed(state(), crypto.randomUUID(), legacy),
        config,
        null,
      );
      expect(response?.status).toBe(200);
      const status = (await (
        await handle(api("status"), config, alice)
      )?.json()) as { subscription: { status: string } };
      expect(status.subscription.status).toBe("active");
      expect(await (await handle(api("status"), config, bob))?.json()).toEqual({
        subscription: null,
      });
    },
  );

  it("rejects missing/bad signatures, stale timestamp and payload tampering without persistence", async () => {
    await seed();
    const bad = signed(state());
    bad.headers.set("webhook-signature", "v1,bad");
    const missing = signed(state());
    missing.headers.delete("webhook-signature");
    const old = signed(
      state(),
      crypto.randomUUID(),
      false,
      new Date(Date.now() - 600_000),
    );
    const original = signed(state());
    const tampered = new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: JSON.stringify(state(bob.id)),
    });
    for (const req of [bad, missing, old, tampered])
      expect((await handle(req, config, null))?.status).toBe(403);
    const row = await config.DB.prepare(
      "SELECT COUNT(*) AS n FROM billing_events",
    ).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("atomically handles concurrent duplicate events once", async () => {
    await seed();
    const eventId = crypto.randomUUID();
    const event = state();
    const results = await Promise.all([
      handle(signed(event, eventId), config, null),
      handle(signed(event, eventId), config, null),
    ]);
    expect(results.map((response) => response?.status)).toEqual([200, 200]);
    const row = await config.DB.prepare(
      "SELECT COUNT(*) AS n FROM billing_events",
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
    expect(
      (await handle(signed(state(alice.id, false), eventId), config, null))
        ?.status,
    ).toBe(409);
  });

  it("does not restore access when an older active event follows revocation", async () => {
    await seed();
    const now = Date.now();
    await handle(signed(state(alice.id, true, now - 1000)), config, null);
    await handle(signed(state(alice.id, false, now)), config, null);
    await handle(signed(state(alice.id, true, now - 500)), config, null);
    const status = (await (
      await handle(api("status"), config, alice)
    )?.json()) as { subscription: { status: string } };
    expect(status.subscription.status).toBe("inactive");
  });

  it("fails closed for conflicting states with identical timestamps", async () => {
    await seed();
    const now = Date.now();
    await handle(signed(state(alice.id, true, now)), config, null);
    await handle(signed(state(alice.id, false, now)), config, null);
    const status = (await (
      await handle(api("status"), config, alice)
    )?.json()) as { subscription: { status: string } };
    expect(status.subscription.status).toBe("ambiguous");
  });

  it("ignores unknown external owners and rejects customer remapping", async () => {
    expect((await handle(signed(state()), config, null))?.status).toBe(200);
    expect(await (await handle(api("status"), config, alice))?.json()).toEqual({
      subscription: null,
    });
    await seed();
    expect((await handle(signed(state()), config, null))?.status).toBe(200);
    expect(
      (
        await handle(
          signed(state(alice.id, true, Date.now() + 1000, "another-customer")),
          config,
          null,
        )
      )?.status,
    ).toBe(409);
  });

  it("does not grant another product and expires access without relying on a later webhook", async () => {
    await seed();
    const event = state();
    event.data.active_subscriptions[0].product_id = "another-product";
    await handle(signed(event), config, null);
    let status = (await (
      await handle(api("status"), config, alice)
    )?.json()) as { subscription: { status: string } };
    expect(status.subscription.status).toBe("inactive");
    const expired = state(alice.id, true, Date.now() + 1000);
    expired.data.active_subscriptions[0].current_period_end = new Date(
      Date.now() - 1000,
    ).toISOString();
    await handle(signed(expired), config, null);
    status = (await (await handle(api("status"), config, alice))?.json()) as {
      subscription: { status: string };
    };
    expect(status.subscription.status).toBe("expired");
  });

  it("does not return success or persist an event when state storage fails", async () => {
    await seed();
    await config.DB.exec(
      "CREATE TRIGGER billing_test_failure BEFORE INSERT ON billing_subscriptions BEGIN SELECT RAISE(ABORT, 'test_failure'); END",
    );
    try {
      expect((await handle(signed(state()), config, null))?.status).toBe(500);
      const row = await config.DB.prepare(
        "SELECT COUNT(*) AS n FROM billing_events",
      ).first<{ n: number }>();
      expect(row?.n).toBe(0);
    } finally {
      await config.DB.exec("DROP TRIGGER billing_test_failure");
    }
    expect((await handle(signed(state()), config, null))?.status).toBe(200);
  });

  it("compares billing period timestamps across explicit timezone offsets", async () => {
    await seed();
    const event = state();
    event.data.active_subscriptions[0].current_period_end =
      "2030-01-01T12:00:00+09:00";
    event.data.active_subscriptions.push({
      ...event.data.active_subscriptions[0],
      id: "later-subscription",
      current_period_end: "2030-01-01T08:00:00Z",
    });
    expect((await handle(signed(event), config, null))?.status).toBe(200);
    const response = (await (
      await handle(api("status"), config, alice)
    )?.json()) as { subscription: { id: string } };
    expect(response.subscription.id).toBe("later-subscription");
  });
});
