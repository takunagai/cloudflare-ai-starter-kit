import type { ZodType } from "zod";
import { type AppEnv, isLocalDevelopment, isLoopbackHostname } from "./env";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export async function readJson<T>(
  request: Request,
  schema: ZodType<T>,
  maxBytes = 32768,
): Promise<T> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new ApiError(415, "unsupported_media_type");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_json");
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, "invalid_input");
  return result.data;
}

export function guardRequestEnvironment(request: Request, env: AppEnv): void {
  const url = new URL(request.url);
  if (env.APP_ENV === "local") {
    if (!isLocalDevelopment(env) || !isLoopbackHostname(url.hostname)) {
      throw new ApiError(503, "unsafe_local_configuration");
    }
  } else if (
    !["staging", "production"].includes(env.APP_ENV) ||
    !env.APP_ORIGIN.startsWith("https://") ||
    url.origin !== env.APP_ORIGIN
  ) {
    throw new ApiError(503, "invalid_application_origin");
  }
}

export function requireSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) {
    throw new ApiError(403, "origin_not_allowed");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new ApiError(403, "origin_not_allowed");
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError)
    return json({ error: error.code }, error.status);
  // Do not log raw provider errors, request data, or database parameters.
  return json({ error: "internal_error" }, 500);
}
