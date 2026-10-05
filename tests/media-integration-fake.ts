import { MEDIA_MODEL_IDS } from "../src/server/media/catalog";
import { handleMediaSource } from "../src/server/media/grants";
import { pngCrc } from "../src/server/media/image-inspection";
import type { MediaEnv } from "../src/server/media/policy";
import { syntheticMp3, syntheticWav } from "./media-audio-fixtures";
import { SYNTHETIC_MP4 } from "./media-video-fixtures";

// アプリ側定数を期待値へ流用せず、M-0の採用契約を独立したoracleにする。
const EXPECTED_SUBMISSION_HEADERS = {
  "X-Fal-Request-Timeout": "120",
  "X-Fal-No-Retry": "1",
  "x-app-fal-disable-fallback": "true",
  "X-Fal-Store-IO": "0",
  "X-Fal-Object-Lifecycle-Preference": JSON.stringify({
    expiration_duration_seconds: 3600,
    initial_acl: { default: "forbid", rules: [] },
  }),
};
// 詳細endpointとQueueアプリを分ける。公式SDKのowner/alias単位の管理契約。
const EXPECTED_QUEUE_APPLICATIONS = [
  "openai/gpt-image-2.5",
  "minimax/h3-max",
  "google/gemini-3.8-flash-tts",
  "google/gemini-3.8-flash-lite-tts",
  "elevenlabs/tts",
  "elevenlabs/music",
];

// previewへcloudflare:test/Vitestを持ち込まない、固定1024角の合成PNG。
async function syntheticIntegrationImage() {
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, 1024);
  view.setUint32(4, 1024);
  header[8] = 8;
  header[9] = 2;
  const compressor = new CompressionStream("deflate");
  const compressed = new Response(compressor.readable).arrayBuffer();
  const writer = compressor.writable.getWriter();
  await writer.write(new Uint8Array(1024 * (1024 * 3 + 1)));
  await writer.close();
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const [name, data] of [
    ["IHDR", header],
    ["IDAT", new Uint8Array(await compressed)],
    ["IEND", new Uint8Array()],
  ] as const) {
    const part = new Uint8Array(data.length + 12),
      metadata = new DataView(part.buffer);
    metadata.setUint32(0, data.length);
    part.set(new TextEncoder().encode(name), 4);
    part.set(data, 8);
    metadata.setUint32(part.length - 4, pngCrc(part.subarray(4, -4)));
    parts.push(part);
  }
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** ローカル統合専用。固定fake以外の通信は拒否し、grantも実D1/R2で照合する。 */
export function createMediaIntegrationFake(
  configuration: () => MediaEnv,
  options: { isWaiting?: boolean; hasUnknownSubmission?: boolean } = {},
) {
  const requests = new Map<
    string,
    {
      model: string;
      input: Record<string, unknown>;
      checks: number;
      isCancelled: boolean;
    }
  >();
  const submissions: { model: string; input: Record<string, unknown> }[] = [];
  let downloadCount = 0;
  async function output(record: {
    model: string;
    input: Record<string, unknown>;
  }) {
    const index = MEDIA_MODEL_IDS.indexOf(
      record.model as (typeof MEDIA_MODEL_IDS)[number],
    );
    if (index < 4)
      return {
        bytes: await syntheticIntegrationImage(),
        mime: "image/png",
        field: "images",
      };
    if (index < 8)
      return { bytes: SYNTHETIC_MP4, mime: "video/mp4", field: "video" };
    if (index < 10)
      return { bytes: syntheticWav(), mime: "audio/wav", field: "audio" };
    return {
      bytes: await syntheticMp3(
        index === 10 ? 44100 : 48000,
        String(record.input.output_format).endsWith("192") ? 192 : 128,
      ),
      mime: "audio/mpeg",
      field: "audio",
    };
  }
  const transport: typeof fetch = async (resource, initialization) => {
    const url = new URL(String(resource)),
      headers = new Headers(initialization?.headers);
    if (initialization?.redirect !== "error")
      throw new Error("TEST_ONLY_redirect_contract");
    if (url.origin === "https://queue.fal.run") {
      if (headers.get("Authorization") !== `Key ${configuration().FAL_KEY}`)
        throw new Error("TEST_ONLY_queue_authorization");
      const model = MEDIA_MODEL_IDS.find((id) => url.pathname === `/${id}`);
      if (initialization?.method === "POST" && model) {
        for (const [name, value] of Object.entries(EXPECTED_SUBMISSION_HEADERS))
          if (headers.get(name) !== value)
            throw new Error("TEST_ONLY_submission_contract");
        const input = JSON.parse(String(initialization.body)) as Record<
          string,
          unknown
        >;
        for (const source of [
          ...((input.image_urls ??
            input.reference_image_urls ??
            []) as string[]),
          ...[input.image_url, input.end_image_url, input.mask_url].filter(
            (value): value is string => typeof value === "string",
          ),
        ]) {
          const response = await handleMediaSource(
            new Request(source),
            configuration(),
          );
          if (response.status !== 200)
            throw new Error("TEST_ONLY_source_rejected");
          await response.arrayBuffer();
        }
        submissions.push({ model, input });
        if (options.hasUnknownSubmission)
          throw new Error("TEST_ONLY_submission_unknown");
        const id = `TEST_ONLY_m5_${crypto.randomUUID()}`;
        requests.set(id, { model, input, checks: 0, isCancelled: false });
        // 返却URLを信用せず、固定catalog経路を使うことも確認する。
        return Response.json({
          request_id: id,
          response_url: "https://forged.example.invalid/result",
        });
      }
      const match = /\/requests\/([^/]+)(?:\/(status|cancel))?$/.exec(
        url.pathname,
      );
      const record = match ? requests.get(match[1]) : undefined;
      const application = record
        ? EXPECTED_QUEUE_APPLICATIONS.find(
            (id) => record.model === id || record.model.startsWith(`${id}/`),
          )
        : undefined;
      if (
        !record ||
        !application ||
        !url.pathname.startsWith(`/${application}/requests/`)
      )
        throw new Error("TEST_ONLY_queue_path_rejected");
      if (match?.[2] === "cancel") {
        record.isCancelled = true;
        return Response.json({ status: "COMPLETED" });
      }
      if (match?.[2] === "status")
        return Response.json({
          status:
            options.isWaiting && ++record.checks < 2 && !record.isCancelled
              ? "IN_QUEUE"
              : "COMPLETED",
        });
      const result = await output(record);
      const file = {
        url: `https://v3b.fal.media/files/b/${match?.[1]}/output`,
        content_type: result.mime,
        file_size: result.bytes.length,
      };
      return Response.json(
        result.field === "images"
          ? {
              images: Array.from(
                { length: Number(record.input.num_images) },
                () => ({ ...file, width: 1024, height: 1024 }),
              ),
            }
          : { [result.field]: file },
      );
    }
    if (
      url.href ===
      "https://rest.fal.ai/storage/auth/token?storage_type=fal-cdn-v3"
    )
      return Response.json({
        token: "TEST_ONLY_m5_cdn_token",
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });
    if (url.origin === "https://v3b.fal.media") {
      const match = /^\/files\/b\/([^/]+)\/output$/.exec(url.pathname);
      const record = match ? requests.get(match[1]) : undefined;
      if (
        !record ||
        headers.get("Authorization") !== "Bearer TEST_ONLY_m5_cdn_token"
      )
        throw new Error("TEST_ONLY_cdn_rejected");
      const result = await output(record);
      downloadCount++;
      return new Response(result.bytes, {
        headers: {
          "Content-Type": result.mime,
          "Content-Length": String(result.bytes.length),
        },
      });
    }
    throw new Error("TEST_ONLY_external_fetch_rejected");
  };
  return { transport, submissions, downloadCount: () => downloadCount };
}

export function integrationInput(index: number, reference?: string) {
  if (index < 4)
    return {
      prompt: "TEST_ONLY_image",
      size: { width: 1024, height: 1024 },
      quality: "xhigh",
      count: 1,
      format: "png",
      background: "opaque",
      ...(index % 2 ? { references: [reference] } : {}),
    };
  if (index < 8)
    return {
      prompt: "TEST_ONLY_video",
      duration: 5,
      resolution: "480P",
      ...(index === 4
        ? { aspectRatio: "1:1" }
        : index === 5
          ? { end: reference }
          : index === 6
            ? {
                references: [reference],
                start: reference,
                aspectRatio: "adaptive",
              }
            : {
                start: reference,
                keyframes: [
                  { time: 0, azimuth: 0, elevation: 0, distance: 1 },
                  { time: 1, azimuth: -90, elevation: 0, distance: 1 },
                ],
              }),
    };
  if (index === 8)
    return {
      mode: "single",
      text: "TEST_ONLY speech",
      voice: "Kore",
      instruction: "穏やかに",
    };
  if (index === 9)
    return {
      mode: "dialogue",
      speakers: [
        { alias: "A", voice: "Kore" },
        { alias: "B", voice: "Puck" },
      ],
      turns: [
        { alias: "B", text: "二" },
        { alias: "A", text: "一" },
      ],
    };
  if (index === 10)
    return {
      text: "TEST_ONLY speech",
      voice: "Aria",
      language: "ja",
      stability: 0.2,
      similarityBoost: 0.9,
      seed: 0,
      normalization: "off",
      format: "mp3_44100_192",
    };
  return {
    prompt: "TEST_ONLY music",
    duration: 3,
    instrumental: true,
    format: "mp3_48000_192",
  };
}
