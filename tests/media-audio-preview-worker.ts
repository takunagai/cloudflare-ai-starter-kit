// ローカル合成preview専用。fal/AI/メール/決済を含む外部fetchを固定fake以外すべて拒否。

import { AUDIO_ENDPOINTS } from "../src/lib/media-audio-options";
import app from "../src/server";
import type { MediaEnv } from "../src/server/media/policy";
import { syntheticMp3, syntheticWav } from "./media-audio-fixtures";

export { SummaryWorkflow } from "../src/server/extensions/workflows";

const REQUESTS = new Map<
  string,
  {
    index: number;
    checks: number;
    isCancelled: boolean;
    input: Record<string, unknown>;
  }
>();
globalThis.fetch = async (resource, options) => {
  const url = new URL(String(resource));
  if (url.origin === "https://queue.fal.run") {
    if (options?.method === "POST") {
      const index = AUDIO_ENDPOINTS.findIndex(
        (id) => url.pathname === `/${id}`,
      );
      if (index < 0) throw new Error("TEST_ONLY_endpoint_rejected");
      const id = `TEST_ONLY_m4_${crypto.randomUUID()}`;
      REQUESTS.set(id, {
        index,
        checks: 0,
        isCancelled: false,
        input: JSON.parse(String(options.body)),
      });
      return Response.json({ request_id: id });
    }
    const match = /\/requests\/([^/]+)(?:\/(status|cancel))?$/.exec(
      url.pathname,
    );
    const request = match ? REQUESTS.get(match[1]) : undefined;
    if (!request) throw new Error("TEST_ONLY_request_missing");
    if (match?.[2] === "cancel") {
      request.isCancelled = true;
      return Response.json({ status: "COMPLETED" });
    }
    if (match?.[2] === "status")
      return Response.json({
        status:
          ++request.checks < 2 && !request.isCancelled
            ? "IN_QUEUE"
            : "COMPLETED",
      });
    const bytes =
      request.index < 2
        ? syntheticWav()
        : await syntheticMp3(
            request.index === 2 ? 44100 : 48000,
            String(request.input.output_format).endsWith("192") ? 192 : 128,
          );
    return Response.json({
      audio: {
        url: `https://v3b.fal.media/files/b/${match?.[1]}/audio`,
        content_type: request.index < 2 ? "audio/wav" : "audio/mpeg",
        file_size: bytes.length,
      },
    });
  }
  if (
    url.href ===
    "https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3"
  )
    return Response.json({
      token: "TEST_ONLY_m4_cdn_token",
      expires_at: new Date(Date.now() + 300000).toISOString(),
    });
  if (url.origin === "https://v3b.fal.media") {
    const match = /^\/files\/b\/([^/]+)\/audio$/.exec(url.pathname),
      request = match ? REQUESTS.get(match[1]) : undefined;
    if (
      !request ||
      new Headers(options?.headers).get("Authorization") !==
        "Bearer TEST_ONLY_m4_cdn_token"
    )
      throw new Error("TEST_ONLY_cdn_rejected");
    const bytes =
      request.index < 2
        ? syntheticWav()
        : await syntheticMp3(
            request.index === 2 ? 44100 : 48000,
            String(request.input.output_format).endsWith("192") ? 192 : 128,
          );
    return new Response(bytes, {
      headers: {
        "Content-Type": request.index < 2 ? "audio/wav" : "audio/mpeg",
        "Content-Length": String(bytes.length),
      },
    });
  }
  throw new Error("TEST_ONLY_external_fetch_rejected");
};
export default {
  async fetch(request: Request, env: MediaEnv, context: ExecutionContext) {
    if (new URL(request.url).pathname === "/__m4-fixture")
      return Response.json({ isSynthetic: true });
    return app.fetch(request, env, context);
  },
} satisfies ExportedHandler<MediaEnv>;
