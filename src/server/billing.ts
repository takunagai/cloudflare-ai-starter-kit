import { Buffer } from "node:buffer";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import type { AppEnv, Identity } from "./env";
import {
  ApiError,
  errorResponse,
  json,
  readJson,
  requireSameOrigin,
} from "./http";
import {
  checkExtensionRuntimePolicy,
  requireExtensionEnabled,
} from "./runtime-guards";

type Server = "sandbox" | "production";
export interface BillingProvider {
  checkout(input: {
    ownerId: string;
    productId: string;
    operationId: string;
    returnUrl: string;
  }): Promise<{ id: string; url: string; expiresAt: Date }>;
  portal(input: {
    ownerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
}

export function createPolarProvider(env: AppEnv): BillingProvider {
  requireExtensionEnabled(env, env.ENABLE_BILLING);
  if (!env.POLAR_ACCESS_TOKEN)
    throw new ApiError(503, "billing_not_configured");
  // SDK 1.xは要求ごとにfetchを1回だけ呼び、再送しない。timeoutは秒指定。
  const polar = createPolar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    environment: serverFor(env),
    timeout: 8,
  });
  return {
    async checkout(input) {
      requireExtensionEnabled(env, env.ENABLE_BILLING);
      await checkExtensionRuntimePolicy(env);
      const result = checkoutResponse.parse(
        await polar.checkouts.create({
          products: [input.productId],
          external_customer_id: input.ownerId,
          metadata: {
            owner_id: input.ownerId,
            operation_id: input.operationId,
          },
          success_url: input.returnUrl,
          return_url: input.returnUrl,
          allow_discount_codes: false,
        }),
      );
      return {
        id: result.id,
        url: result.url,
        expiresAt: new Date(result.expires_at),
      };
    },
    async portal(input) {
      requireExtensionEnabled(env, env.ENABLE_BILLING);
      await checkExtensionRuntimePolicy(env);
      const result = portalResponse.parse(
        await polar.customerSessions.create({
          external_customer_id: input.ownerId,
          return_url: input.returnUrl,
        }),
      );
      return { url: result.customer_portal_url };
    },
  };
}

function serverFor(env: AppEnv): Server {
  if (
    env.POLAR_SERVER !== undefined &&
    !["sandbox", "production"].includes(env.POLAR_SERVER)
  )
    throw new ApiError(503, "billing_not_configured");
  return env.POLAR_SERVER ?? "sandbox";
}
function productFor(env: AppEnv): string {
  if (!env.POLAR_PRODUCT_ID) throw new ApiError(503, "billing_not_configured");
  return env.POLAR_PRODUCT_ID;
}
function safePolarUrl(url: string, server: Server): string {
  const parsed = new URL(url);
  const allowed = server === "sandbox" ? ["sandbox.polar.sh"] : ["polar.sh"];
  if (
    parsed.protocol !== "https:" ||
    !allowed.includes(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new ApiError(502, "invalid_billing_response");
  }
  return parsed.href;
}

const emptyBody = z.object({}).strict();
const id = z.string().min(1).max(500);
const isoDate = z.iso.datetime({ offset: true });
// SDK 1.xは応答を検証しないため、使う項目だけをここで検証する。
const checkoutResponse = z.object({
  id,
  url: z.string(),
  expires_at: isoDate,
});
const portalResponse = z.object({ customer_portal_url: z.string() });
const stateEvent = z.object({
  type: z.literal("customer.state_changed"),
  timestamp: isoDate,
  data: z.object({
    id,
    external_id: id.nullish(),
    active_subscriptions: z
      .array(
        z.object({
          id,
          product_id: id,
          status: z.enum(["active", "trialing"]),
          current_period_end: isoDate,
          cancel_at_period_end: z.boolean(),
        }),
      )
      .max(100),
  }),
});
const checkoutEvent = z.object({
  type: z.enum(["checkout.created", "checkout.updated", "checkout.expired"]),
  timestamp: isoDate,
  data: z.object({
    id,
    external_customer_id: id,
    product_id: id,
    metadata: z.object({ owner_id: id, operation_id: id }),
    status: z.enum(["open", "expired", "confirmed", "failed", "succeeded"]),
    url: z.string().url(),
    expires_at: isoDate,
  }),
});
const envelope = z.object({ type: z.string().max(100) });

async function rawBody(request: Request): Promise<string> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(415, "unsupported_media_type");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_webhook");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large");
      }
      body += decoder.decode(part.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function verifyWebhook(
  body: string,
  request: Request,
  secret: string,
): unknown {
  const headers = Object.fromEntries(
    ["webhook-id", "webhook-timestamp", "webhook-signature"].map((name) => [
      name,
      request.headers.get(name) ?? "",
    ]),
  );
  // Polarは2026-09-08以降のsecretをStandard Webhooksへ変更。
  // 公式standardwebhooksで新旧キーの双方を検証する。SDK 1.xのvalidateEventも両対応だが、
  // event型がAPI版に固定されるため使わない（0.49は旧キーしか扱わなかった）。
  for (const key of [secret, Buffer.from(secret, "utf8").toString("base64")]) {
    try {
      return new Webhook(key).verify(body, headers);
    } catch {
      /* 次の署名方式を試す。秘密入り例外は保存しない。 */
    }
  }
  throw new ApiError(403, "invalid_webhook_signature");
}
async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function webhook(request: Request, env: AppEnv): Promise<Response> {
  if (!env.POLAR_WEBHOOK_SECRET)
    throw new ApiError(503, "billing_not_configured");
  const server = serverFor(env);
  const product = productFor(env);
  const body = await rawBody(request);
  const parsed = verifyWebhook(body, request, env.POLAR_WEBHOOK_SECRET);
  const eventId = request.headers.get("webhook-id");
  if (!eventId || eventId.length > 200)
    throw new ApiError(400, "invalid_webhook");
  const type = envelope.safeParse(parsed);
  if (!type.success) throw new ApiError(400, "invalid_webhook");
  const customerEvent =
    type.data.type === "customer.state_changed"
      ? stateEvent.safeParse(parsed)
      : null;
  const checkoutNotification = [
    "checkout.created",
    "checkout.updated",
    "checkout.expired",
  ].includes(type.data.type)
    ? checkoutEvent.safeParse(parsed)
    : null;
  if (
    (customerEvent && !customerEvent.success) ||
    (checkoutNotification && !checkoutNotification.success)
  )
    throw new ApiError(400, "invalid_webhook");
  await checkExtensionRuntimePolicy(env);
  const hash = await digest(body);
  const existing = await env.DB.prepare(
    "SELECT body_hash FROM billing_events WHERE event_id = ? AND server = ?",
  )
    .bind(eventId, server)
    .first<{ body_hash: string }>();
  if (existing) {
    if (existing.body_hash !== hash)
      throw new ApiError(409, "webhook_id_conflict");
    await checkExtensionRuntimePolicy(env);
    return json({ received: true, duplicate: true });
  }
  const saveEvent = env.DB.prepare(
    "INSERT INTO billing_events(event_id, server, body_hash, received_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
  ).bind(eventId, server, hash, Date.now());
  if (customerEvent?.success) {
    const event = customerEvent;
    const data = event.data.data;
    if (!data.external_id) {
      await checkExtensionRuntimePolicy(env);
      await saveEvent.run();
      return json({ received: true, ignored: true });
    }
    const customer = await env.DB.prepare(
      "SELECT customer_id FROM billing_customers WHERE owner_id = ? AND server = ?",
    )
      .bind(data.external_id, server)
      .first<{ customer_id: string | null }>();
    // 事前に認証済みcheckoutで登録したowner以外へ権限を作らない。
    if (!customer) {
      // 同じPolar organizationの別アプリ顧客。権限を作らず受領して再送嵐を避ける。
      await checkExtensionRuntimePolicy(env);
      await saveEvent.run();
      return json({ received: true, ignored: true });
    }
    if (customer.customer_id !== null && customer.customer_id !== data.id)
      throw new ApiError(409, "billing_customer_mismatch");
    const subscriptions = data.active_subscriptions
      .filter((sub) => sub.product_id === product)
      .sort(
        (a, b) =>
          Date.parse(b.current_period_end) - Date.parse(a.current_period_end),
      );
    const active = subscriptions[0];
    const status = active?.status ?? "inactive";
    const end = active ? Date.parse(active.current_period_end) : null;
    const stateHash = await digest(
      JSON.stringify([
        active?.id ?? null,
        status,
        end,
        active?.cancel_at_period_end ?? false,
      ]),
    );
    await checkExtensionRuntimePolicy(env);
    await env.DB.batch([
      saveEvent,
      env.DB.prepare(
        "UPDATE billing_customers SET customer_id = ? WHERE owner_id = ? AND server = ? AND (customer_id IS NULL OR customer_id = ?) AND EXISTS(SELECT 1 FROM billing_events WHERE event_id = ? AND server = ? AND body_hash = ?)",
      ).bind(data.id, data.external_id, server, data.id, eventId, server, hash),
      env.DB.prepare(`INSERT INTO billing_subscriptions(owner_id, server, subscription_id, product_id, status, period_end, cancel_at_period_end, event_time, state_hash)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM billing_customers WHERE owner_id = ? AND server = ? AND customer_id = ?) AND EXISTS(SELECT 1 FROM billing_events WHERE event_id = ? AND server = ? AND body_hash = ?)
        ON CONFLICT(owner_id, server, product_id) DO UPDATE SET
          subscription_id = excluded.subscription_id, period_end = excluded.period_end, cancel_at_period_end = excluded.cancel_at_period_end,
          status = CASE WHEN excluded.event_time = billing_subscriptions.event_time AND excluded.state_hash != billing_subscriptions.state_hash THEN 'ambiguous' ELSE excluded.status END,
          event_time = excluded.event_time, state_hash = excluded.state_hash
        WHERE excluded.event_time > billing_subscriptions.event_time OR (excluded.event_time = billing_subscriptions.event_time AND excluded.state_hash != billing_subscriptions.state_hash)`).bind(
        data.external_id,
        server,
        active?.id ?? null,
        product,
        status,
        end,
        Number(active?.cancel_at_period_end ?? false),
        Date.parse(event.data.timestamp),
        stateHash,
        data.external_id,
        server,
        data.id,
        eventId,
        server,
        hash,
      ),
    ]);
  } else if (checkoutNotification?.success) {
    const event = checkoutNotification;
    const data = event.data.data;
    if (
      data.metadata.owner_id !== data.external_customer_id ||
      data.product_id !== product
    )
      throw new ApiError(409, "billing_customer_mismatch");
    const state = ["expired", "failed"].includes(data.status)
      ? "expired"
      : data.status === "succeeded"
        ? "completed"
        : "ready";
    const url = safePolarUrl(data.url, server);
    await checkExtensionRuntimePolicy(env);
    await env.DB.batch([
      saveEvent,
      env.DB.prepare(`UPDATE billing_checkouts SET checkout_id = ?, url = ?, expires_at = ?, state = ?, event_time = ?, completed_at = ?
        WHERE owner_id = ? AND server = ? AND product_id = ? AND operation_id = ?
        AND state IN ('pending', 'uncertain', 'ready')
        AND (event_time IS NULL OR event_time <= ?)
        AND EXISTS(SELECT 1 FROM billing_events WHERE event_id = ? AND server = ? AND body_hash = ?)`).bind(
        data.id,
        url,
        Date.parse(data.expires_at),
        state,
        Date.parse(event.data.timestamp),
        state === "completed" ? Date.parse(event.data.timestamp) : null,
        data.external_customer_id,
        server,
        product,
        data.metadata.operation_id,
        Date.parse(event.data.timestamp),
        eventId,
        server,
        hash,
      ),
    ]);
  } else {
    // 未使用イベントも署名を検証した上で永続受領。権限は変えない。
    await checkExtensionRuntimePolicy(env);
    await saveEvent.run();
  }
  const stored = await env.DB.prepare(
    "SELECT body_hash FROM billing_events WHERE event_id = ? AND server = ?",
  )
    .bind(eventId, server)
    .first<{ body_hash: string }>();
  if (stored?.body_hash !== hash)
    throw new ApiError(409, "webhook_id_conflict");
  return json({ received: true });
}

interface CheckoutRow {
  operation_id: string;
  state: string;
  url: string | null;
  expires_at: number | null;
}
async function createCheckout(
  env: AppEnv,
  identity: Identity,
  provider: BillingProvider,
): Promise<Response> {
  const server = serverFor(env);
  const product = productFor(env);
  const entitled = await env.DB.prepare(
    "SELECT 1 AS present FROM billing_subscriptions WHERE owner_id = ? AND server = ? AND product_id = ? AND status IN ('active', 'trialing') AND period_end > ?",
  )
    .bind(identity.id, server, product, Date.now())
    .first();
  if (entitled) throw new ApiError(409, "subscription_already_purchased");
  await checkExtensionRuntimePolicy(env);
  const operation = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO billing_customers(owner_id, server) VALUES (?, ?) ON CONFLICT DO NOTHING",
    ).bind(identity.id, server),
    env.DB.prepare(`INSERT INTO billing_checkouts(owner_id, server, product_id, operation_id, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(owner_id, server, product_id) DO UPDATE SET operation_id = excluded.operation_id, state = 'pending', url = NULL, checkout_id = NULL, expires_at = NULL, event_time = NULL, completed_at = NULL, created_at = excluded.created_at
      WHERE billing_checkouts.state = 'expired' OR (
        billing_checkouts.state = 'completed' AND billing_checkouts.completed_at IS NOT NULL
        AND EXISTS(SELECT 1 FROM billing_subscriptions s
          WHERE s.owner_id = billing_checkouts.owner_id AND s.server = billing_checkouts.server
          AND s.product_id = billing_checkouts.product_id AND s.status = 'inactive'
          AND s.event_time >= billing_checkouts.completed_at)
      )`).bind(identity.id, server, product, operation, Date.now()),
  ]);
  const reservation = await env.DB.prepare(
    "SELECT operation_id, state, url, expires_at FROM billing_checkouts WHERE owner_id = ? AND server = ? AND product_id = ?",
  )
    .bind(identity.id, server, product)
    .first<CheckoutRow>();
  if (reservation?.operation_id !== operation) {
    if (
      reservation?.state === "ready" &&
      reservation.url &&
      (reservation.expires_at ?? 0) > Date.now()
    )
      return json({ url: safePolarUrl(reservation.url, server) });
    throw new ApiError(
      409,
      reservation?.state === "completed"
        ? "subscription_already_purchased"
        : "checkout_pending_reconciliation",
    );
  }
  let dispatched = false;
  try {
    await checkExtensionRuntimePolicy(env);
    dispatched = true;
    const result = await provider.checkout({
      ownerId: identity.id,
      productId: product,
      operationId: operation,
      returnUrl: `${env.APP_ORIGIN}/app`,
    });
    const url = safePolarUrl(result.url, server);
    if (
      !Number.isFinite(result.expiresAt.getTime()) ||
      result.expiresAt.getTime() <= Date.now()
    )
      throw new ApiError(502, "invalid_billing_response");
    await checkExtensionRuntimePolicy(env);
    await env.DB.prepare(
      "UPDATE billing_checkouts SET checkout_id = ?, url = ?, expires_at = ?, state = 'ready' WHERE operation_id = ? AND state = 'pending'",
    )
      .bind(result.id, url, result.expiresAt.getTime(), operation)
      .run();
    return json({ url });
  } catch (error) {
    await env.DB.prepare(
      "UPDATE billing_checkouts SET state = ? WHERE operation_id = ? AND state = 'pending'",
    )
      .bind(dispatched ? "uncertain" : "expired", operation)
      .run();
    if (error instanceof ApiError && error.status === 503) throw error;
    throw new ApiError(502, "checkout_pending_reconciliation");
  }
}

async function subscriptionFor(env: AppEnv, identity: Identity) {
  const subscription = await env.DB.prepare(
    "SELECT subscription_id AS id, status, period_end AS periodEnd, cancel_at_period_end AS cancelAtPeriodEnd FROM billing_subscriptions WHERE owner_id = ? AND server = ? AND product_id = ?",
  )
    .bind(identity.id, serverFor(env), productFor(env))
    .first<{
      id: string | null;
      status: string;
      periodEnd: number | null;
      cancelAtPeriodEnd: number;
    }>();
  if (!subscription) return null;
  if (
    ["active", "trialing"].includes(subscription.status) &&
    (subscription.periodEnd ?? 0) <= Date.now()
  )
    subscription.status = "expired";
  return {
    ...subscription,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
  };
}

export function createBillingHandler(
  makeProvider: (env: AppEnv) => BillingProvider = createPolarProvider,
) {
  return async (
    request: Request,
    env: AppEnv,
    identity: Identity | null,
  ): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/billing/")) return null;
    try {
      requireExtensionEnabled(env, env.ENABLE_BILLING);
      if (path === "/api/billing/webhook") {
        if (request.method !== "POST")
          return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
        return await webhook(request, env);
      }
      if (!identity) throw new ApiError(401, "unauthorized");
      if (["/api/billing/status", "/api/billing/member"].includes(path)) {
        if (request.method !== "GET")
          return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
        await checkExtensionRuntimePolicy(env);
        const subscription = await subscriptionFor(env, identity);
        if (path === "/api/billing/member") {
          if (
            !subscription ||
            !["active", "trialing"].includes(subscription.status) ||
            (subscription.periodEnd ?? 0) <= Date.now()
          )
            throw new ApiError(403, "subscription_required");
          return json({
            message: "有効な契約を確認しました。会員向け機能を利用できます。",
          });
        }
        return json({ subscription });
      }
      if (!["/api/billing/checkout", "/api/billing/portal"].includes(path))
        throw new ApiError(404, "not_found");
      if (request.method !== "POST")
        return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
      requireSameOrigin(request);
      await readJson(request, emptyBody, 1024);
      if (path === "/api/billing/checkout") {
        await checkExtensionRuntimePolicy(env);
        return await createCheckout(env, identity, makeProvider(env));
      }
      const server = serverFor(env);
      const customer = await env.DB.prepare(
        "SELECT customer_id FROM billing_customers WHERE owner_id = ? AND server = ?",
      )
        .bind(identity.id, server)
        .first<{ customer_id: string | null }>();
      if (!customer?.customer_id)
        throw new ApiError(409, "billing_customer_unavailable");
      await checkExtensionRuntimePolicy(env);
      productFor(env);
      const provider = makeProvider(env);
      const session = await provider.portal({
        ownerId: identity.id,
        returnUrl: `${env.APP_ORIGIN}/app`,
      });
      return json({ url: safePolarUrl(session.url, server) });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const handleBilling = createBillingHandler();
