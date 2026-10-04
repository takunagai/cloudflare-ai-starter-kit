import jpegFactory from "@jsquash/jpeg/codec/dec/mozjpeg_dec.js";
import jpegWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import webpFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import webpWasm from "@jsquash/webp/codec/dec/webp_dec.wasm";
import { ApiError } from "../http";

export const IMAGE_MIMES = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
} as const;
export type ImageFormat = keyof typeof IMAGE_MIMES;
export interface InspectedImage {
  format: ImageFormat;
  bytes: number;
  width: number;
  height: number;
  hasAlpha: boolean;
}
let isImageOperationActive = false;
/** isolate内でファイルbuffer/decoderを重ねない。待機列には本文を保持しない。 */
export async function imageOperation<T>(operation: () => Promise<T>) {
  if (isImageOperationActive)
    throw new ApiError(429, "media_image_inspector_busy");
  isImageOperationActive = true;
  try {
    return await operation();
  } finally {
    isImageOperationActive = false;
  }
}
export async function boundedBytes(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal?: AbortSignal,
) {
  if (!stream) throw new ApiError(400, "media_file_empty");
  const reader = stream.getReader();
  const bytes = new Uint8Array(limit);
  let length = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      if (length + part.value.length > limit)
        throw new ApiError(413, "media_file_too_large");
      bytes.set(part.value, length);
      length += part.value.length;
    }
    if (!length) throw new ApiError(400, "media_file_empty");
    return bytes.subarray(0, length);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
function invalid(): never {
  throw new ApiError(400, "media_image_invalid");
}
function dimensions(width: number, height: number) {
  if (
    !width ||
    !height ||
    Math.max(width, height) > 4096 ||
    width * height > 8_294_400
  )
    invalid();
}
function text(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
export function pngCrc(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const ADAM7 = [
  [0, 0, 1, 1],
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;
async function png(bytes: Uint8Array<ArrayBuffer>) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 45 || text(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n") invalid();
  let width = 0,
    height = 0,
    depth = 0,
    color = 0,
    interlace = 0;
  let hasAlpha = false,
    hasEnd = false,
    hasDataEnded = false;
  let paletteSize = 0;
  const data: Uint8Array<ArrayBuffer>[] = [];
  const seen = new Set<string>();
  for (let offset = 8; offset < bytes.length; ) {
    if (offset + 12 > bytes.length) invalid();
    const length = view.getUint32(offset),
      kind = text(bytes, offset + 4, 4),
      end = offset + length + 12;
    if (
      end > bytes.length ||
      !/^[A-Za-z]{4}$/.test(kind) ||
      pngCrc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)
    )
      invalid();
    if (offset === 8 && kind !== "IHDR") invalid();
    if (["acTL", "fcTL", "fdAT"].includes(kind)) invalid();
    if (kind === "IHDR") {
      if (seen.has(kind) || length !== 13) invalid();
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      dimensions(width, height);
      depth = bytes[offset + 16];
      color = bytes[offset + 17];
      interlace = bytes[offset + 20];
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !depths[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        interlace > 1
      )
        invalid();
      hasAlpha = color === 4 || color === 6;
    } else if (kind === "PLTE") {
      if (
        seen.has(kind) ||
        data.length ||
        !length ||
        length % 3 ||
        length > 768 ||
        color === 0 ||
        color === 4
      )
        invalid();
      paletteSize = length / 3;
      if (color === 3 && paletteSize > 2 ** depth) invalid();
    } else if (kind === "tRNS") {
      if (
        seen.has(kind) ||
        data.length ||
        ![0, 2, 3].includes(color) ||
        (color === 0 && length !== 2) ||
        (color === 2 && length !== 6) ||
        (color === 3 && (!paletteSize || !length || length > paletteSize))
      )
        invalid();
      hasAlpha = true;
    } else if (kind === "IDAT") {
      if (hasDataEnded || (color === 3 && !paletteSize)) invalid();
      data.push(bytes.subarray(offset + 8, end - 4));
    } else if (kind === "IEND") {
      if (length || !data.length || end !== bytes.length) invalid();
      hasEnd = true;
    } else if (kind[0] === kind[0].toUpperCase()) invalid();
    if (data.length && kind !== "IDAT") hasDataEnded = true;
    seen.add(kind);
    offset = end;
  }
  if (!hasEnd) invalid();
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[
    color
  ];
  const bits = channels * depth,
    stride = Math.max(1, Math.ceil(bits / 8));
  const passes = (interlace ? ADAM7.slice(1) : ADAM7.slice(0, 1))
    .map(([x, y, dx, dy]) => ({
      width: Math.max(0, Math.ceil((width - x) / dx)),
      height: Math.max(0, Math.ceil((height - y) / dy)),
    }))
    .filter((pass) => pass.width && pass.height);
  const inflater = new ReadableStream<BufferSource>({
    start(controller) {
      for (const chunk of data) controller.enqueue(chunk);
      controller.close();
    },
  }).pipeThrough(new DecompressionStream("deflate"));
  const reader = inflater.getReader();
  let passIndex = 0,
    rowIndex = 0,
    rowOffset = 0;
  let row = new Uint8Array(Math.ceil((passes[0].width * bits) / 8) + 1),
    previous = new Uint8Array(row.length - 1);
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      for (const byte of part.value) {
        if (passIndex >= passes.length) invalid();
        row[rowOffset++] = byte;
        if (rowOffset !== row.length) continue;
        const filter = row[0];
        if (filter > 4) invalid();
        for (let index = 1; index < row.length; index++) {
          const left = index > stride ? row[index - stride] : 0,
            above = previous[index - 1],
            upperLeft = index > stride ? previous[index - stride - 1] : 0;
          let predictor = 0;
          if (filter === 1) predictor = left;
          if (filter === 2) predictor = above;
          if (filter === 3) predictor = Math.floor((left + above) / 2);
          if (filter === 4) {
            const p = left + above - upperLeft,
              a = Math.abs(p - left),
              b = Math.abs(p - above),
              c = Math.abs(p - upperLeft);
            predictor = a <= b && a <= c ? left : b <= c ? above : upperLeft;
          }
          row[index] = (row[index] + predictor) & 255;
        }
        if (color === 3)
          for (let pixel = 0; pixel < passes[passIndex].width; pixel++) {
            const value =
              (row[1 + Math.floor((pixel * depth) / 8)] >>>
                (8 - depth - ((pixel * depth) % 8))) &
              (2 ** depth - 1);
            if (value >= paletteSize) invalid();
          }
        previous.set(row.subarray(1));
        rowOffset = 0;
        rowIndex++;
        if (rowIndex === passes[passIndex].height) {
          passIndex++;
          rowIndex = 0;
          if (passIndex < passes.length) {
            row = new Uint8Array(
              Math.ceil((passes[passIndex].width * bits) / 8) + 1,
            );
            previous = new Uint8Array(row.length - 1);
          }
        }
      }
    }
    if (rowOffset || passIndex !== passes.length) invalid();
  } catch {
    await reader.cancel().catch(() => {});
    invalid();
  } finally {
    reader.releaseLock();
  }
  return { width, height, hasAlpha };
}
function jpeg(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (bytes[0] !== 255 || bytes[1] !== 216) invalid();
  let width = 0,
    height = 0,
    scans = 0,
    hasEnd = false;
  for (let offset = 2; offset < bytes.length; ) {
    if (bytes[offset++] !== 255) invalid();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) {
      if (offset !== bytes.length) invalid();
      hasEnd = true;
      break;
    }
    if (offset + 2 > bytes.length || marker === 0 || marker === 216) invalid();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) invalid();
    if ([192, 193, 194].includes(marker)) {
      if (width || length < 8 || bytes[offset + 2] !== 8) invalid();
      height = view.getUint16(offset + 3);
      width = view.getUint16(offset + 5);
      dimensions(width, height);
    } else if (
      marker >= 195 &&
      marker <= 207 &&
      ![196, 200, 204].includes(marker)
    )
      invalid();
    offset += length;
    if (marker === 218) {
      if (!width || ++scans > 64) invalid();
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) {
          offset++;
          continue;
        }
        let next = offset + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) {
          offset = next + 1;
          continue;
        }
        break;
      }
      if (offset === scanStart) invalid();
    }
  }
  if (!hasEnd || !scans) invalid();
  return { width, height, hasAlpha: false };
}
function webp(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (
    bytes.length < 20 ||
    text(bytes, 0, 4) !== "RIFF" ||
    text(bytes, 8, 4) !== "WEBP" ||
    view.getUint32(4, true) + 8 !== bytes.length
  )
    invalid();
  let width = 0,
    height = 0,
    hasAlpha = false,
    images = 0,
    hasExtended = false;
  for (let offset = 12; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) invalid();
    const kind = text(bytes, offset, 4),
      length = view.getUint32(offset + 4, true),
      start = offset + 8,
      end = start + length;
    if (end + (length % 2) > bytes.length || ["ANIM", "ANMF"].includes(kind))
      invalid();
    if (kind === "VP8X") {
      if (
        offset !== 12 ||
        length !== 10 ||
        bytes[start] & 0xc3 ||
        bytes[start + 1] ||
        bytes[start + 2] ||
        bytes[start + 3]
      )
        invalid();
      hasExtended = true;
      hasAlpha = Boolean(bytes[start] & 16);
      width =
        1 +
        bytes[start + 4] +
        (bytes[start + 5] << 8) +
        (bytes[start + 6] << 16);
      height =
        1 +
        bytes[start + 7] +
        (bytes[start + 8] << 8) +
        (bytes[start + 9] << 16);
      dimensions(width, height);
    } else if (kind === "VP8 " || kind === "VP8L") {
      if (++images !== 1 || length < (kind === "VP8 " ? 10 : 5)) invalid();
      let actualWidth: number, actualHeight: number;
      if (kind === "VP8 ") {
        if (bytes[start] & 1 || text(bytes, start + 3, 3) !== "\x9d\x01\x2a")
          invalid();
        const partitionBytes =
          (bytes[start] +
            (bytes[start + 1] << 8) +
            (bytes[start + 2] << 16)) >>>
          5;
        if (!partitionBytes || partitionBytes > length - 10) invalid();
        actualWidth = view.getUint16(start + 6, true) & 0x3fff;
        actualHeight = view.getUint16(start + 8, true) & 0x3fff;
      } else {
        if (bytes[start] !== 47 || bytes[start + 4] & 0xe0) invalid();
        const packed = view.getUint32(start + 1, true);
        actualWidth = (packed & 0x3fff) + 1;
        actualHeight = ((packed >>> 14) & 0x3fff) + 1;
        hasAlpha ||= Boolean(packed & 0x10000000);
      }
      dimensions(actualWidth, actualHeight);
      if (hasExtended && (width !== actualWidth || height !== actualHeight))
        invalid();
      width = actualWidth;
      height = actualHeight;
    } else if (kind === "ALPH") {
      if (!hasExtended || !hasAlpha || images) invalid();
    } else if (!["ICCP", "EXIF", "XMP "].includes(kind)) invalid();
    offset = end + (length % 2);
  }
  if (!images) invalid();
  return { width, height, hasAlpha };
}
export async function inspectImage(
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
): Promise<InspectedImage> {
  try {
    let format: ImageFormat,
      metadata: { width: number; height: number; hasAlpha: boolean };
    if (bytes[0] === 137) {
      format = "png";
      metadata = await png(bytes);
    } else if (bytes[0] === 255) {
      format = "jpeg";
      metadata = jpeg(bytes);
    } else {
      format = "webp";
      metadata = webp(bytes);
    }
    if (IMAGE_MIMES[format] !== mime) invalid();
    if (format !== "png") {
      // 同一isolateへcodecの大きいheapを複数残さず、呼出し単位でinstanceを作る。
      const module = format === "jpeg" ? jpegWasm : webpWasm;
      let hasCodecWarning = false;
      const options = {
        noInitialRun: true,
        print: () => {
          hasCodecWarning = true;
        },
        printErr: () => {
          hasCodecWarning = true;
        },
        instantiateWasm(
          imports: WebAssembly.Imports,
          receive: (instance: WebAssembly.Instance) => void,
        ) {
          const instance = new WebAssembly.Instance(module, imports);
          receive(instance);
          return instance.exports;
        },
      };
      const decoded =
        format === "jpeg"
          ? (await jpegFactory(options)).decode(bytes, false)
          : (await webpFactory(options)).decode(bytes);
      if (
        hasCodecWarning ||
        !decoded ||
        decoded.width !== metadata.width ||
        decoded.height !== metadata.height ||
        decoded.data.length !== metadata.width * metadata.height * 4
      )
        invalid();
    }
    return { format, bytes: bytes.length, ...metadata };
  } catch {
    invalid();
  }
}
