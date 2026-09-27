import { inputSchema } from "../lib/contracts";
import { handleApp } from "./app-api";
import type { AppEnv } from "./env";

const maxBodyBytes = 2048;

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function readBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export default {
  async fetch(
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api/health") {
      if (!["GET", "HEAD"].includes(request.method)) {
        return json({ error: "method_not_allowed" }, 405, {
          Allow: "GET, HEAD",
        });
      }
      const response = json({ status: "ok", runtime: "cloudflare-workers" });
      return request.method === "HEAD"
        ? new Response(null, response)
        : response;
    }
    if (path === "/api/validate") {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
      }
      const contentType = request.headers
        .get("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        return json({ error: "unsupported_media_type" }, 415);
      }
      let value: unknown;
      try {
        const text = await readBody(request);
        if (text === null) return json({ error: "payload_too_large" }, 413);
        value = JSON.parse(text);
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      const result = inputSchema.safeParse(value);
      if (!result.success) return json({ error: "invalid_input" }, 400);
      return json({ valid: true, length: result.data.message.length });
    }
    if (
      /^\/api\/(auth\/|session$|models$|conversations(?:\/|$)|chat$|approvals(?:\/|$)|notes$|extensions\/|billing\/)/.test(
        path,
      )
    ) {
      return handleApp(request, env, ctx);
    }
    return json({ error: "not_found" }, 404);
  },
};
