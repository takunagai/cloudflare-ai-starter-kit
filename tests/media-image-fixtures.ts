import { reserveUpload, uploadAsset } from "../src/server/media/assets";
import { pngCrc } from "../src/server/media/image-inspection";
import type { MediaEnv } from "../src/server/media/policy";
import { MEDIA_ALICE, MEDIA_ENV } from "./media-fixtures";
export async function savedMediaImage(
  bytes: Uint8Array<ArrayBuffer>,
  mime = "image/png",
  identity = MEDIA_ALICE,
  config: MediaEnv = MEDIA_ENV,
) {
  const reservation = await reserveUpload(config, identity, {
    bytes: bytes.length,
    contentType: mime,
  });
  return uploadAsset(
    new Request(`http://127.0.0.1:3000${reservation.uploadPath}`, {
      method: "PUT",
      headers: { "Content-Type": mime },
      body: bytes,
    }),
    config,
    identity,
    reservation.id,
  );
}
export function pngChunk(type: string, data: Uint8Array<ArrayBuffer>) {
  const chunk = new Uint8Array(data.length + 12),
    view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(chunk.length - 4, pngCrc(chunk.subarray(4, chunk.length - 4)));
  return chunk;
}
export function concatenate(parts: Uint8Array<ArrayBuffer>[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export async function syntheticPng(
  width = 1024,
  height = 1024,
  options: {
    hasAlpha?: boolean;
    isAnimated?: boolean;
    filter?: number;
    extraInflatedByte?: boolean;
  } = {},
) {
  const channels = options.hasAlpha ? 4 : 3,
    header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = options.hasAlpha ? 6 : 2;
  const raw = new Uint8Array(
    height * (width * channels + 1) + (options.extraInflatedByte ? 1 : 0),
  );
  for (let row = 0; row < height; row++) {
    raw[row * (width * channels + 1)] = options.filter ?? 0;
    for (let x = 0; x < width; x++) {
      const offset = row * (width * channels + 1) + 1 + x * channels;
      raw[offset] = 20;
      raw[offset + 1] = 80;
      raw[offset + 2] = 130;
      if (options.hasAlpha) raw[offset + 3] = x % 2 ? 255 : 0;
    }
  }
  const compressor = new CompressionStream("deflate"),
    writer = compressor.writable.getWriter();
  const output = new Response(compressor.readable).arrayBuffer();
  await writer.write(raw);
  await writer.close();
  return concatenate([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    ...(options.isAnimated ? [pngChunk("acTL", new Uint8Array(8))] : []),
    pngChunk("IDAT", new Uint8Array(await output)),
    pngChunk("IEND", new Uint8Array()),
  ]);
}
export const SYNTHETIC_JPEG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDhqKKK908U/9k=",
  ),
  (char) => char.charCodeAt(0),
);
export const SYNTHETIC_WEBP = Uint8Array.from(
  atob(
    "UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoQABAAAUAmJaACdLoB+AAETAAA/vS+7/43ZCofbz/33oDeBgAAAA==",
  ),
  (char) => char.charCodeAt(0),
);
