import { ApiError } from "../http";
import { MEDIA_LIMITS } from "./catalog";
import { validateAvcConfiguration } from "./h264-metadata";

const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_BOXES = 4096;
type Box = { type: string; data: Uint8Array<ArrayBuffer> };
const invalid = (): never => {
  throw new ApiError(502, "media_video_invalid");
};
const view = (bytes: Uint8Array<ArrayBuffer>) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const word = (bytes: Uint8Array<ArrayBuffer>, offset: number) => {
  if (offset + 4 > bytes.length) return invalid();
  return view(bytes).getUint32(offset);
};
const long = (bytes: Uint8Array<ArrayBuffer>, offset: number) => {
  if (offset + 8 > bytes.length) return invalid();
  const value = Number(view(bytes).getBigUint64(offset));
  return Number.isSafeInteger(value) ? value : invalid();
};
const text = (bytes: Uint8Array<ArrayBuffer>, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));
function boxes(bytes: Uint8Array<ArrayBuffer>): Box[] {
  const result: Box[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    if (bytes.length - offset < 8 || result.length >= MAX_BOXES)
      return invalid();
    const shortSize = word(bytes, offset),
      header = shortSize === 1 ? 16 : 8;
    const size = shortSize === 1 ? long(bytes, offset + 8) : shortSize;
    if (size < header || size > bytes.length - offset) return invalid();
    result.push({
      type: text(bytes, offset + 4),
      data: bytes.subarray(offset + header, offset + size),
    });
    offset += size;
  }
  return result;
}
function one(items: Box[], type: string) {
  const matches = items.filter((item) => item.type === type);
  return matches.length === 1 ? matches[0].data : invalid();
}
function clock(bytes: Uint8Array<ArrayBuffer>) {
  if (![0, 1].includes(bytes[0])) return invalid();
  const offset = bytes[0] === 1 ? 20 : 12;
  const scale = word(bytes, offset),
    duration =
      bytes[0] === 1 ? long(bytes, offset + 4) : word(bytes, offset + 4);
  if (!scale || !duration) return invalid();
  return { scale, ticks: duration, seconds: duration / scale };
}
function table(bytes: Uint8Array<ArrayBuffer>, stride: number) {
  if (word(bytes, 0) !== 0) return invalid();
  const count = word(bytes, 4);
  if (!count || count > 10000 || bytes.length !== 8 + count * stride)
    return invalid();
  return count;
}
/** mdatは読み込まず、限定したmoovとsample tableを検査する。codecの全画素デコードではない。 */
export async function inspectVideo(
  read: (offset: number, length: number) => Promise<Uint8Array<ArrayBuffer>>,
  bytes: number,
) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > MEDIA_LIMITS.videoBytes
  )
    return invalid();
  let movie: Uint8Array<ArrayBuffer> | undefined,
    hasBrand = false;
  const mediaRanges: { start: number; end: number }[] = [];
  for (let offset = 0, count = 0; offset < bytes; ) {
    if (++count > MAX_BOXES || bytes - offset < 8) return invalid();
    const header = await read(offset, Math.min(16, bytes - offset));
    const shortSize = word(header, 0),
      headerSize = shortSize === 1 ? 16 : 8;
    const size = shortSize === 1 ? long(header, 8) : shortSize;
    const type = text(header, 4);
    if (size < headerSize || size > bytes - offset) return invalid();
    if (offset === 0 && type !== "ftyp") return invalid();
    if (type === "ftyp") {
      if (hasBrand || size > 1024 || size < 16 || (size - headerSize) % 4 !== 0)
        return invalid();
      const brands = await read(offset + headerSize, size - headerSize);
      hasBrand = [
        0,
        ...Array.from(
          { length: (brands.length - 8) / 4 },
          (_, index) => 8 + index * 4,
        ),
      ].some((position) =>
        ["isom", "iso2", "mp41", "mp42", "avc1"].includes(
          text(brands, position),
        ),
      );
      if (!hasBrand) return invalid();
    } else if (type === "moov") {
      if (movie || size > MAX_METADATA_BYTES) return invalid();
      movie = await read(offset + headerSize, size - headerSize);
    } else if (type === "mdat") {
      if (size <= headerSize || mediaRanges.length >= 32) return invalid();
      mediaRanges.push({ start: offset + headerSize, end: offset + size });
    } else if (!["free", "skip", "wide"].includes(type)) return invalid();
    offset += size;
  }
  if (!movie || !hasBrand || !mediaRanges.length) return invalid();
  const children = boxes(movie),
    movieClock = clock(one(children, "mvhd"));
  const tracks = children.filter((item) => item.type === "trak");
  if (
    !tracks.length ||
    tracks.length > 2 ||
    children.some((item) => item.type === "mvex")
  )
    return invalid();
  const chunks: { start: number; end: number }[] = [];
  let video: { width: number; height: number; duration: number } | undefined;
  for (const track of tracks) {
    const contents = boxes(track.data),
      trackHeader = one(contents, "tkhd");
    const media = boxes(one(contents, "mdia")),
      timing = clock(one(media, "mdhd"));
    const handler = text(one(media, "hdlr"), 8);
    if (
      !["vide", "soun"].includes(handler) ||
      Math.abs(timing.seconds - movieClock.seconds) > 0.25
    )
      return invalid();
    const information = boxes(one(media, "minf"));
    const references = one(boxes(one(information, "dinf")), "dref");
    if (word(references, 0) !== 0 || word(references, 4) !== 1)
      return invalid();
    const locations = boxes(references.subarray(8));
    if (
      locations.length !== 1 ||
      locations[0].type !== "url " ||
      locations[0].data.length !== 4 ||
      word(locations[0].data, 0) !== 1
    )
      return invalid();
    const samples = boxes(one(information, "stbl"));
    const description = one(samples, "stsd");
    if (word(description, 0) !== 0 || word(description, 4) !== 1)
      return invalid();
    const entries = boxes(description.subarray(8));
    if (
      entries.length !== 1 ||
      entries[0].data.length < 8 ||
      view(entries[0].data).getUint16(6) !== 1
    )
      return invalid();
    if (handler === "vide") {
      if (
        video ||
        !["avc1", "avc3"].includes(entries[0].type) ||
        entries[0].data.length < 78
      )
        return invalid();
      const width = view(entries[0].data).getUint16(24),
        height = view(entries[0].data).getUint16(26);
      const configuration = one(boxes(entries[0].data.subarray(78)), "avcC");
      validateAvcConfiguration(configuration, width, height);
      if (
        ![0, 1].includes(trackHeader[0]) ||
        trackHeader.length !== (trackHeader[0] === 0 ? 84 : 96)
      )
        return invalid();
      const matrixOffset = trackHeader[0] === 0 ? 40 : 52;
      const matrix = [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
      if (
        matrix.some(
          (value, index) =>
            word(trackHeader, matrixOffset + index * 4) !== value,
        )
      )
        return invalid();
      if (
        configuration.length < 7 ||
        configuration[0] !== 1 ||
        !(configuration[5] & 31)
      )
        return invalid();
      if (
        width < 64 ||
        height < 64 ||
        width % 2 ||
        height % 2 ||
        Math.max(width, height) > 4096 ||
        width * height > 8294400 ||
        word(trackHeader, trackHeader.length - 8) !== width * 65536 ||
        word(trackHeader, trackHeader.length - 4) !== height * 65536
      )
        return invalid();
      video = { width, height, duration: timing.seconds };
    } else if (entries[0].type !== "mp4a") return invalid();
    const sizes = one(samples, "stsz"),
      constantSize = word(sizes, 4),
      sampleCount = word(sizes, 8);
    if (
      word(sizes, 0) !== 0 ||
      !sampleCount ||
      sampleCount > 10000 ||
      sizes.length !== 12 + (constantSize ? 0 : sampleCount * 4)
    )
      return invalid();
    const timeToSample = one(samples, "stts"),
      timeCount = table(timeToSample, 8);
    let timedSamples = 0,
      ticks = 0;
    for (let index = 0; index < timeCount; index++) {
      const count = word(timeToSample, 8 + index * 8),
        delta = word(timeToSample, 12 + index * 8);
      if (!count || !delta) return invalid();
      timedSamples += count;
      ticks += count * delta;
    }
    if (timedSamples !== sampleCount || Math.abs(ticks - timing.ticks) > 1)
      return invalid();
    const offsetBoxes = samples.filter((item) =>
      ["stco", "co64"].includes(item.type),
    );
    if (offsetBoxes.length !== 1) return invalid();
    const offsets = offsetBoxes[0],
      stride = offsets.type === "co64" ? 8 : 4,
      chunkCount = table(offsets.data, stride);
    const mapping = one(samples, "stsc"),
      mapCount = table(mapping, 12);
    let sampleIndex = 0,
      mapIndex = 0;
    for (let index = 0; index < mapCount; index++) {
      const firstChunk = word(mapping, 8 + index * 12);
      if (
        (index === 0 && firstChunk !== 1) ||
        firstChunk > chunkCount ||
        (index && firstChunk <= word(mapping, 8 + (index - 1) * 12)) ||
        !word(mapping, 12 + index * 12) ||
        word(mapping, 16 + index * 12) !== 1
      )
        return invalid();
    }
    for (let index = 0; index < chunkCount; index++) {
      if (
        mapIndex + 1 < mapCount &&
        word(mapping, 8 + (mapIndex + 1) * 12) === index + 1
      )
        mapIndex++;
      const count = word(mapping, 12 + mapIndex * 12);
      if (sampleIndex + count > sampleCount) return invalid();
      let length = 0;
      for (let sample = 0; sample < count; sample++) {
        const size = constantSize || word(sizes, 12 + sampleIndex * 4);
        if (!size) return invalid();
        length += size;
        sampleIndex++;
      }
      const start =
        stride === 8
          ? long(offsets.data, 8 + index * stride)
          : word(offsets.data, 8 + index * stride);
      const end = start + length;
      if (
        !Number.isSafeInteger(end) ||
        !mediaRanges.some((range) => start >= range.start && end <= range.end)
      )
        return invalid();
      chunks.push({ start, end });
    }
    if (sampleIndex !== sampleCount) return invalid();
  }
  chunks.sort((left, right) => left.start - right.start);
  if (
    chunks.some(
      (chunk, index) => index > 0 && chunk.start < chunks[index - 1].end,
    ) ||
    !video
  )
    return invalid();
  return { ...video, bytes, format: "mp4" as const };
}

export function validateVideoRequest(
  video: { width: number; height: number; duration: number },
  input: { duration: number; resolution: string; aspectRatio?: string },
  canvas?: { width: number; height: number },
) {
  const resolution = Number(input.resolution.slice(0, -1));
  const shortSide = Math.min(video.width, video.height);
  const ratio = canvas
    ? canvas.width / canvas.height
    : input.aspectRatio && input.aspectRatio !== "adaptive"
      ? Number(input.aspectRatio.split(":")[0]) /
        Number(input.aspectRatio.split(":")[1])
      : undefined;
  if (
    !Number.isFinite(video.duration) ||
    video.duration < input.duration - 0.05 ||
    video.duration > input.duration + 0.75 ||
    Math.abs(shortSide - resolution) > 32 ||
    (ratio !== undefined &&
      Math.abs(video.width / video.height - ratio) / ratio > 0.05)
  )
    return invalid();
}
