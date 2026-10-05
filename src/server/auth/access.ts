import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AppEnv, Identity } from "../env";

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function accessIssuer(domain: string | undefined): string | null {
  if (
    !domain ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i.test(domain)
  ) {
    return null;
  }
  return `https://${domain.toLowerCase()}`;
}

/** テストはkey resolverだけを差し替え、署名・claims検証自体は省略しない。 */
export async function verifyAccessIdentity(
  request: Request,
  env: Pick<AppEnv, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">,
  keyResolver?: JWTVerifyGetKey,
  maximumLifetimeSeconds?: number,
): Promise<Identity | null> {
  const issuer = accessIssuer(env.ACCESS_TEAM_DOMAIN);
  const assertion = request.headers.get("cf-access-jwt-assertion");
  if (!issuer || !env.ACCESS_AUD || !assertion || assertion.length > 16_384)
    return null;
  try {
    let keys = keyResolver ?? keySets.get(issuer);
    if (!keys) {
      const remoteKeys = createRemoteJWKSet(
        new URL(`${issuer}/cdn-cgi/access/certs`),
        {
          timeoutDuration: 5000,
          cooldownDuration: 30_000,
          cacheMaxAge: 600_000,
        },
      );
      // 設定はサーバー側固定。別teamへ設定変更された場合の無制限蓄積を避ける。
      if (keySets.size >= 8) keySets.clear();
      keySets.set(issuer, remoteKeys);
      keys = remoteKeys;
    }
    const { payload } = await jwtVerify(assertion, keys, {
      algorithms: ["RS256"],
      issuer,
      audience: env.ACCESS_AUD,
      requiredClaims: ["sub", "email", "exp", "iat", "iss", "aud"],
      clockTolerance: 5,
    });
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 256 ||
      typeof payload.email !== "string" ||
      !payload.email.includes("@") ||
      payload.email.length > 320 ||
      /[\r\n]/.test(payload.email) ||
      payload.type !== "app" ||
      typeof payload.iat !== "number" ||
      payload.iat > Date.now() / 1000 + 5 ||
      (maximumLifetimeSeconds !== undefined &&
        (typeof payload.exp !== "number" ||
          payload.exp - payload.iat > maximumLifetimeSeconds + 5))
    )
      return null;
    // issuerも含め、同じsubが別Access teamで衝突しないようにする。
    return {
      id: `access:${new URL(issuer).hostname}:${payload.sub}`,
      email: payload.email,
      name:
        typeof payload.name === "string" && payload.name.length <= 200
          ? payload.name
          : payload.email,
    };
  } catch {
    // JWT、claims、fetch例外をログやレスポンスへ返さない。
    return null;
  }
}
