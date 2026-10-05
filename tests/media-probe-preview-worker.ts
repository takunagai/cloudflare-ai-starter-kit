import { exportJWK, generateKeyPair, SignJWT } from "jose";
import app from "../src/server";
import api from "../src/server/api";
import { getIdentity } from "../src/server/auth";
import { normalizeMedia } from "../src/server/media/catalog";
import type { MediaEnv } from "../src/server/media/policy";
import {
  PROBE_APPROVAL_VERSION,
  PROBE_CLOCK,
  probeInput,
} from "../src/server/media/probe-permit";
import { handleMediaProbe } from "../src/server/media/probe-routes";
import { inputHash } from "../src/server/media/service";
import { createMediaIntegrationFake } from "./media-integration-fake";

export { SummaryWorkflow } from "../src/server/extensions/workflows";

const ORIGIN = "https://probe.example.test",
  ISSUER = "https://example-probe.cloudflareaccess.com",
  OWNER = "access:example-probe.cloudflareaccess.com:fixture-subject";
const KEYS = generateKeyPair("RS256", { extractable: true });
let configuration: MediaEnv;
let offset = 0,
  tokenIndex = 0,
  firstOutputAt = 0;
const TOKENS = new Map<string, number>();
const FAKE = createMediaIntegrationFake(() => configuration);
const now = () => Date.now() + offset;
globalThis.fetch = async (resource, initialization) => {
  const url = String(resource),
    headers = new Headers(initialization?.headers);
  if (url === `${ISSUER}/cdn-cgi/access/certs`)
    return Response.json({
      keys: [
        {
          ...(await exportJWK((await KEYS).publicKey)),
          kid: "TEST_ONLY_e_preview",
          alg: "RS256",
          use: "sig",
        },
      ],
    });
  if (initialization?.redirect !== "manual")
    throw new Error("TEST_ONLY_e_redirect_contract");
  if (url.startsWith("https://rest.fal.ai/storage/files/acl?"))
    return Response.json({ default: "forbid", rules: [] });
  if (url.includes("/storage/auth/token?")) {
    const token = `TEST_ONLY_e_preview_${++tokenIndex}`;
    TOKENS.set(token, now() + 300000);
    return Response.json({
      token,
      expires_at: new Date(now() + 300000).toISOString(),
    });
  }
  if (url.startsWith("https://v3b.fal.media/")) {
    const credential = headers.get("Authorization")?.slice(7);
    if (!credential || (TOKENS.get(credential) ?? 0) <= now())
      return new Response(null, { status: 403 });
    if (firstOutputAt && now() >= firstOutputAt + 3600000)
      return new Response(null, { status: 410 });
    headers.set("Authorization", "Bearer TEST_ONLY_m5_cdn_token");
    return FAKE.transport(resource, {
      ...initialization,
      headers,
      redirect: "error",
    });
  }
  const response = await FAKE.transport(resource, {
    ...initialization,
    redirect: "error",
  });
  if (/\/requests\/[^/]+$/.test(url) && !firstOutputAt) firstOutputAt = now();
  return response;
};
export default {
  async fetch(
    request: Request,
    environment: MediaEnv,
    context: ExecutionContext,
  ) {
    const url = new URL(request.url);
    if (
      environment.APP_ENV !== "local" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      environment.FAL_KEY
    )
      return new Response("TEST_ONLY local fixture required", { status: 503 });
    configuration = {
      ...environment,
      APP_ENV: "staging",
      STAGING_POLICY: "standard",
      APP_ORIGIN: ORIGIN,
      AUTH_MODE: "access",
      LOCAL_DEMO: "false",
      AI_MODE: "off",
      AI_ALLOWED_MODELS: "[]",
      JEV_MODE: "off",
      ENABLE_MEDIA_PROBE: "true",
      MEDIA_PROBE_APPROVAL_VERSION: PROBE_APPROVAL_VERSION,
      FAL_KEY: "TEST_ONLY_e_preview_key",
      ACCESS_TEAM_DOMAIN: "example-probe.cloudflareaccess.com",
      ACCESS_AUD: "TEST_ONLY_e_preview_audience",
    };
    if (url.pathname === "/__e-fixture")
      return Response.json({
        isSynthetic: true,
        isTimeAccelerated: true,
        maximumGenerationRequests: 1,
        submitted: FAKE.submissions.length,
      });
    if (url.pathname === "/__e-fixture/setup" && request.method === "POST") {
      const exists = await environment.DB.prepare(
        "SELECT 1 FROM media_probe_run",
      ).first();
      if (exists) return Response.json({ isAlreadyRegistered: true });
      const time =
        (
          await environment.DB.prepare(`SELECT ${PROBE_CLOCK} AS now`).first<{
            now: number;
          }>()
        )?.now ?? Date.now();
      const key = `${new Date(time).toISOString().slice(0, 10)}:${crypto.randomUUID()}`;
      await environment.DB.batch([
        environment.DB.prepare(
          "INSERT INTO media_probe_run(id,approval_version,owner_id,app_origin,started_at,expires_at) VALUES(1,?,?,?,?,?)",
        ).bind(
          PROBE_APPROVAL_VERSION,
          OWNER,
          ORIGIN,
          time - 1000,
          time - 1000 + 1800000,
        ),
        environment.DB.prepare(
          "INSERT INTO media_probe_slots VALUES(1,1,?,?)",
        ).bind(key, await inputHash(normalizeMedia(probeInput(key)))),
      ]);
      return Response.json({ isRegistered: true });
    }
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      headers.set("Origin", ORIGIN);
      headers.set(
        "cf-access-jwt-assertion",
        await new SignJWT({
          sub: "fixture-subject",
          email: "e-preview@example.test",
          type: "app",
        })
          .setProtectedHeader({ alg: "RS256", kid: "TEST_ONLY_e_preview" })
          .setIssuer(ISSUER)
          .setAudience(configuration.ACCESS_AUD ?? "")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign((await KEYS).privateKey),
      );
      const incoming = new Request(ORIGIN + url.pathname + url.search, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "manual",
      });
      if (
        url.pathname.endsWith("/token-observation") ||
        url.pathname.endsWith("/expiry")
      ) {
        if (url.pathname.endsWith("/expiry"))
          offset = Math.max(offset, 3600001);
        const identity = await getIdentity(incoming, configuration);
        if (!identity) return new Response(null, { status: 401 });
        return handleMediaProbe(incoming, configuration, identity, {
          now,
          sleep: async (milliseconds, signal) => {
            if (signal.aborted) throw new Error("TEST_ONLY_interrupted");
            offset += milliseconds;
          },
        });
      }
      const result = await api.fetch(incoming, configuration, context);
      if (url.pathname === "/api/media-probe" && result.ok)
        return Response.json(
          {
            ...((await result.json()) as Record<string, unknown>),
            isSynthetic: true,
          },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      return result;
    }
    return app.fetch(request, environment, context);
  },
} satisfies ExportedHandler<MediaEnv>;
