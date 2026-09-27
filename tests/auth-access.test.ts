import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getIdentity } from "../src/server/auth";
import { verifyAccessIdentity } from "../src/server/auth/access";
import type { AppEnv } from "../src/server/env";

const issuer = "https://example-team1.cloudflareaccess.com";
const config = {
  ACCESS_TEAM_DOMAIN: "example-team1.cloudflareaccess.com",
  ACCESS_AUD: "test-audience",
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: Awaited<ReturnType<typeof exportJWK>>[] };

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  jwks = {
    keys: [
      {
        ...(await exportJWK(keys.publicKey)),
        kid: "test-key",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function assertion(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    sub: "local-fixture-subject",
    email: "alice@example.test",
    type: "app",
    iss: issuer,
    aud: [config.ACCESS_AUD],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(keys.privateKey);
}
function request(token: string) {
  return new Request("https://starter.example.test/api/session", {
    headers: { "cf-access-jwt-assertion": token },
  });
}
function verify(token: string) {
  return verifyAccessIdentity(request(token), config, createLocalJWKSet(jwks));
}

describe("Cloudflare Access assertion verification in Workers", () => {
  it("verifies real RSA signatures and gives the Access identity an issuer-scoped namespace", async () => {
    const identity = await verify(await assertion());
    expect(identity?.id).toBe(
      "access:example-team1.cloudflareaccess.com:local-fixture-subject",
    );
    expect(identity?.email).toBe("alice@example.test");
  });

  it.each([
    { iss: "https://example-team2.cloudflareaccess.com" },
    { aud: ["another-application"] },
    { exp: Math.floor(Date.now() / 1000) - 60 },
    { iat: Math.floor(Date.now() / 1000) + 600 },
    { nbf: Math.floor(Date.now() / 1000) + 600 },
    { sub: "" },
    { email: "" },
    { email: "not-an-email" },
    { type: "service-token" },
  ])("rejects invalid claims %#", async (claims) => {
    expect(await verify(await assertion(claims))).toBeNull();
  });

  it("rejects a missing expiry, untrusted key, and modified signature", async () => {
    const unsignedExpiry = await new SignJWT({
      sub: "subject",
      email: "alice@example.test",
      type: "app",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(config.ACCESS_AUD)
      .setIssuedAt()
      .sign(keys.privateKey);
    expect(await verify(unsignedExpiry)).toBeNull();
    const other = await generateKeyPair("RS256");
    const untrusted = await new SignJWT({
      sub: "subject",
      email: "alice@example.test",
      type: "app",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(config.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await verify(untrusted)).toBeNull();
    const token = await assertion();
    const parts = token.split(".");
    parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
    expect(await verify(parts.join("."))).toBeNull();
  });

  it("rejects unsupported algorithms and malformed assertions", async () => {
    const hmac = await new SignJWT({
      sub: "subject",
      email: "alice@example.test",
      type: "app",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(issuer)
      .setAudience(config.ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("test-fixture-only-not-a-real-secret"));
    expect(await verify(hmac)).toBeNull();
    expect(await verify("not-a-token")).toBeNull();
    expect(await verify("x".repeat(16_385))).toBeNull();
  });

  it("fetches only the configured Access JWKS and ignores unverified identity headers", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        expect(String(input)).toBe(`${issuer}/cdn-cgi/access/certs`);
        return Response.json(jwks);
      });
    const identity = await getIdentity(request(await assertion()), {
      AUTH_MODE: "access",
      ...config,
    } as AppEnv);
    expect(identity?.id.startsWith("access:")).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      await getIdentity(
        new Request("https://starter.example.test", {
          headers: {
            "cf-access-authenticated-user-email": "alice@example.test",
          },
        }),
        { AUTH_MODE: "access", ...config } as AppEnv,
      ),
    ).toBeNull();
  });

  it("does not turn a malicious team setting into arbitrary network access", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(
      await verifyAccessIdentity(request(await assertion()), {
        ...config,
        ACCESS_TEAM_DOMAIN: "evil.example/path",
      }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
