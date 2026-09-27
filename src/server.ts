import handler from "@tanstack/react-start/server-entry";
import api from "./server/api";
import type { AppEnv } from "./server/env";

export { SummaryWorkflow } from "./server/extensions/workflows";

export default {
  async fetch(
    request: Request,
    env: AppEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }
    const response = await handler.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    if (path === "/app" || path.startsWith("/app/"))
      headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<AppEnv>;
