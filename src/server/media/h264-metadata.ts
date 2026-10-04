import { ApiError } from "../http";

const invalid = (): never => {
  throw new ApiError(502, "media_video_invalid");
};
/** SPSの符号化寸法を限定して読む。フレームのデコード/品質判定は行わない。 */
function dimensions(nal: Uint8Array<ArrayBuffer>) {
  if (!nal.length || (nal[0] & 31) !== 7 || nal.length > 65535)
    return invalid();
  const bytes = nal
    .slice(1)
    .filter(
      (byte, index) =>
        !(byte === 3 && index > 1 && nal[index] === 0 && nal[index - 1] === 0),
    );
  let position = 0;
  const bits = (count: number) => {
    if (count > 32 || position + count > bytes.length * 8) return invalid();
    let value = 0;
    for (let index = 0; index < count; index++, position++)
      value = value * 2 + ((bytes[position >> 3] >> (7 - (position & 7))) & 1);
    return value;
  };
  const unsigned = () => {
    let zeros = 0;
    while (bits(1) === 0) {
      if (++zeros > 30) return invalid();
    }
    return 2 ** zeros - 1 + bits(zeros);
  };
  const signed = () => {
    const value = unsigned();
    return value % 2 ? (value + 1) / 2 : -value / 2;
  };
  const profile = bits(8);
  bits(16);
  unsigned();
  let chroma = 1,
    hasSeparatePlane = false;
  if (
    [
      100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135, 144,
    ].includes(profile)
  ) {
    chroma = unsigned();
    if (chroma > 3) return invalid();
    if (chroma === 3) hasSeparatePlane = bits(1) === 1;
    if (unsigned() > 6 || unsigned() > 6) return invalid();
    bits(1);
    if (bits(1))
      for (let index = 0; index < (chroma === 3 ? 12 : 8); index++) {
        if (!bits(1)) continue;
        let lastScale = 8,
          nextScale = 8;
        for (let item = 0; item < (index < 6 ? 16 : 64); item++) {
          if (nextScale) nextScale = (lastScale + signed() + 256) % 256;
          if (nextScale) lastScale = nextScale;
        }
      }
  }
  if (unsigned() > 12) return invalid();
  const order = unsigned();
  if (order === 0) {
    if (unsigned() > 12) return invalid();
  } else if (order === 1) {
    bits(1);
    signed();
    signed();
    const count = unsigned();
    if (count > 256) return invalid();
    for (let index = 0; index < count; index++) signed();
  } else if (order !== 2) return invalid();
  if (unsigned() > 16) return invalid();
  bits(1);
  const columns = unsigned() + 1,
    rows = unsigned() + 1;
  if (columns > 256 || rows > 256 || bits(1) !== 1) return invalid(); // 初版はprogressiveだけ。
  bits(1);
  const crops = bits(1)
    ? [unsigned(), unsigned(), unsigned(), unsigned()]
    : [0, 0, 0, 0];
  const color = hasSeparatePlane ? 0 : chroma,
    horizontal = color === 0 || color === 3 ? 1 : 2,
    vertical = color === 1 ? 2 : 1;
  const width = columns * 16 - (crops[0] + crops[1]) * horizontal,
    height = rows * 16 - (crops[2] + crops[3]) * vertical;
  if (width <= 0 || height <= 0) return invalid();
  return { width, height };
}
export function validateAvcConfiguration(
  bytes: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
) {
  if (bytes.length < 7 || bytes[0] !== 1 || (bytes[4] & 3) === 2)
    return invalid();
  let offset = 6;
  const unit = () => {
    if (offset + 2 > bytes.length) return invalid();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    if (!length || offset + length > bytes.length) return invalid();
    const nal = bytes.subarray(offset, offset + length);
    offset += length;
    return nal;
  };
  const count = bytes[5] & 31;
  if (!count) return invalid();
  for (let index = 0; index < count; index++) {
    const actual = dimensions(unit());
    if (actual.width !== width || actual.height !== height) return invalid();
  }
  if (offset >= bytes.length) return invalid();
  const pictureCount = bytes[offset++];
  if (!pictureCount) return invalid();
  for (let index = 0; index < pictureCount; index++)
    if ((unit()[0] & 31) !== 8) return invalid();
}
