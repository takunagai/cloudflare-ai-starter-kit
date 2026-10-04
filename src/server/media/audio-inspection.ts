import { ApiError } from "../http";
import { MEDIA_LIMITS } from "./catalog";

type Read = (offset: number, count: number) => Promise<Uint8Array<ArrayBuffer>>;
export type AudioInspection = {
  format: "wav" | "mp3";
  bytes: number;
  duration: number;
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
  bitrate?: number;
};
const invalid = (): never => {
  throw new ApiError(502, "media_audio_invalid");
};
const ascii = (bytes: Uint8Array, start: number, count: number) =>
  String.fromCharCode(...bytes.subarray(start, start + count));

/** ファイル全体を展開せず、RIFF chunk/MP3 frameを上限付きrangeで照合する。 */
export async function inspectAudio(
  read: Read,
  size: number,
  format: "wav" | "mp3",
): Promise<AudioInspection> {
  if (
    !Number.isSafeInteger(size) ||
    size < 44 ||
    size > MEDIA_LIMITS.audioBytes
  )
    invalid();
  // MP3を1frameずつR2要求にしない。最大64 KiBのwindowだけ保持する。
  let windowStart = -1,
    windowBytes = new Uint8Array(0);
  const take = async (offset: number, count: number) => {
    if (offset < 0 || count < 0 || offset + count > size || count > 65536)
      invalid();
    if (
      offset < windowStart ||
      offset + count > windowStart + windowBytes.length
    ) {
      windowStart = offset;
      windowBytes = await read(offset, Math.min(65536, size - offset));
      if (windowBytes.length !== Math.min(65536, size - offset)) invalid();
    }
    return windowBytes.subarray(
      offset - windowStart,
      offset - windowStart + count,
    );
  };
  if (format === "wav") {
    const head = await take(0, 12),
      view = new DataView(head.buffer, head.byteOffset, head.length);
    if (
      ascii(head, 0, 4) !== "RIFF" ||
      ascii(head, 8, 4) !== "WAVE" ||
      view.getUint32(4, true) + 8 !== size
    )
      invalid();
    let position = 12,
      hasFormat = false,
      dataBytes = 0,
      chunks = 0;
    let sampleRate = 0,
      channels = 0,
      blockAlign = 0;
    while (position < size) {
      if (++chunks > 128) invalid();
      const header = await take(position, 8),
        chunkView = new DataView(
          header.buffer,
          header.byteOffset,
          header.length,
        );
      const name = ascii(header, 0, 4),
        length = chunkView.getUint32(4, true);
      if (position + 8 + length + (length % 2) > size) invalid();
      if (name === "fmt ") {
        if (hasFormat || dataBytes || (length !== 16 && length !== 18))
          invalid();
        const bytes = await take(position + 8, length),
          value = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
        channels = value.getUint16(2, true);
        sampleRate = value.getUint32(4, true);
        blockAlign = value.getUint16(12, true);
        // 初版Gemini: PCM signed 16-bit little endian / mono / 24 kHzのWAV。
        if (
          value.getUint16(0, true) !== 1 ||
          channels !== 1 ||
          sampleRate !== 24000 ||
          blockAlign !== 2 ||
          value.getUint16(14, true) !== 16 ||
          value.getUint32(8, true) !== 48000 ||
          (length === 18 && value.getUint16(16, true) !== 0)
        )
          invalid();
        hasFormat = true;
      } else if (name === "data") {
        if (!hasFormat || dataBytes || !length || length % blockAlign)
          invalid();
        dataBytes = length;
      } else if (!["JUNK", "LIST", "bext"].includes(name) || length > 1048576)
        invalid();
      if (length % 2 && (await take(position + 8 + length, 1))[0] !== 0)
        invalid();
      position += 8 + length + (length % 2);
    }
    if (position !== size || !hasFormat || !dataBytes) invalid();
    return {
      format,
      bytes: size,
      duration: dataBytes / blockAlign / sampleRate,
      sampleRate,
      channels,
      bitsPerSample: 16,
    };
  }
  let position = 0,
    end = size,
    frameCount = 0,
    sampleRate = 0,
    channels = 0,
    bitrate = 0;
  const beginning = await take(0, 10);
  if (ascii(beginning, 0, 3) === "ID3") {
    if (
      ![3, 4].includes(beginning[3]) ||
      beginning[4] !== 0 ||
      beginning[5] !== 0 ||
      beginning.subarray(6, 10).some((byte) => byte >= 128)
    )
      invalid();
    const length = beginning
      .subarray(6, 10)
      .reduce((value, byte) => value * 128 + byte, 0);
    if (length > 1048576 || length + 10 >= end) invalid();
    position = length + 10;
  }
  if (size >= 128 && ascii(await take(size - 128, 3), 0, 3) === "TAG")
    end -= 128;
  let reservoirBytes = 0;
  while (position < end) {
    if (++frameCount > 100000) invalid();
    const header = await take(position, 4);
    if (
      header[0] !== 255 ||
      (header[1] & 0xe0) !== 0xe0 ||
      ((header[1] >> 3) & 3) !== 3 ||
      ((header[1] >> 1) & 3) !== 1 ||
      (header[1] & 1) !== 1 ||
      (header[3] & 3) === 2
    )
      invalid();
    const rateIndex = (header[2] >> 2) & 3,
      bitrateIndex = header[2] >> 4;
    const rate = [44100, 48000, 32000][rateIndex],
      bits = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][
        bitrateIndex
      ];
    const channelCount = header[3] >> 6 === 3 ? 1 : 2;
    if (![44100, 48000].includes(rate) || ![128, 192].includes(bits)) invalid();
    if (
      frameCount > 1 &&
      (rate !== sampleRate || bits !== bitrate || channelCount !== channels)
    )
      invalid();
    sampleRate = rate;
    bitrate = bits;
    channels = channelCount;
    const length = Math.floor((144000 * bits) / rate) + ((header[2] >> 1) & 1),
      sideLength = channels === 1 ? 17 : 32;
    if (position + length > end || length <= 4 + sideLength) invalid();
    const frame = await take(position, length),
      backReference = (frame[4] << 1) | (frame[5] >> 7);
    if (backReference > reservoirBytes) invalid();
    reservoirBytes = Math.min(511, reservoirBytes + length - 4 - sideLength);
    position += length;
  }
  if (position !== end || frameCount < 2) invalid();
  return {
    format,
    bytes: size,
    duration: (frameCount * 1152) / sampleRate,
    sampleRate,
    channels,
    bitrate,
  };
}

export function validateAudioRequest(
  audio: AudioInspection,
  input: { format?: string; duration?: number },
) {
  if (audio.format === "mp3") {
    if (input.format !== `mp3_${audio.sampleRate}_${audio.bitrate}`) invalid();
    // MP3のencoder delay/paddingを含むframe時間。sample精度の一致とは扱わない。
    if (
      input.duration !== undefined &&
      Math.abs(audio.duration - input.duration) > 0.15
    )
      invalid();
  }
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) invalid();
}
