// ffmpeg 8.1.2 / libmp3lameによる3秒の合成無音。実素材・上流接続なし。
const MP3 = {
  "48000-192":
    "eJzt0rGRgQEYANHPUIgKbhgaEFzmQv0oRgkKEOhK8CvB3Gxm3os33OV1f876MavbzGxnjteZzfn093v42e92l8/+0/J1Fv8Q+IfCPxT+ofAPhX8o/EPhHwr/UPiHwj8U/qHwD4V/KPxD4R8K/1D4h8I/FP6h8A+Ffyj8Q+EfCv9Q+IfCPxT+ofAPhX8o/EPhHwr/UPiHwj8U/qHwD4V/KPxD4R8K/1D4h8I/FP6h8A+Ffyj8Q+EfCv9Q+IfCPxT+ofAPhX8o/EPhHwr/UPiHwj8U/qHwD4V/KPxD4R8K/1D4h8I/FP6h8A+Ffyj8Q+EfCv9Q+IfCPxT+ofAPhX8o/EPhHwr/UPiHwj8U/qHwD4V/KPxD4R8K/1D4h8I/FP6h8A+Ffyj8Q+EfCv9Q+IfCPxT+ofAPhX8o/EPhHwr/UPiHwj8U/qHwD4V/KPxD4R8K/1D4h8I/FP6h8A+Ffyj8Q+EfCv9Q+IfCPxT+ofAPxRsClZ2j",
  "44100-128":
    "eJzt2rFNA1EURcGHoBAqQEYmcUhABqH7QXIDFjVQCMF2tcES44jIHKSZBr70j272tvW8zO3X3HzOzP3M0/vM3evz28v+4XG3O/LT9X9mWz+Ww2Wgq73+/yhUp1CdQnUK1SlUp1CdQnUK1SlUp1CdQnUK1SlUp1CdQnUK1SlUp1CdQnUK1SlUp1CdQnF/cEi4reflcFLol0yoTqE6heoUqlOoTqE6heoUqlOoTqE6heoUqlOoTqE6heoUqlOoTqE6heoUqlOoTqE6heKcy9WZUJ1CdQrVKVSnUJ1CdQrVKVSnUJ1CdQrVKVSnUJ1CdQrVKVSnUJ1CdQrVKVSnUJ1CdQrVKRTnoLHOhOoUqlOoTqE6heoUqlOoTqE6heoUqlOoTqE6heoUqlOoTqE6heoUqlOoTqE6heoUqlMozrlcnQnVKVSnUJ1CdQrVKVSnUJ1CdQrVKVSnUJ1CdQrVKVSnUJ1CdQpx6Ru0ZfKA",
  "48000-128":
    "eJzt0DFtAgAURdFPQEgVNBAw0IGlgRE/iEACQjrUFQMwsze3IecoeO/eb5ffWf7M4jozHzO788zq8HXcbz836/XprfzHW/dn/+/X/vWoP6J/S/+W/i39W/q39G/p39K/pX9L/5b+Lf1b+rf0b+nf0r+lf0v/lv4t/Vv6t/Rv6d/Sv6V/S/+W/i39W/q39G/p39K/pX9L/5b+Lf1b+rf0b+nf0r+lf0v/lv4t/Vv6t/Rv6d/Sv6V/S/+W/i39W/q39G/p39K/pX9L/5b+Lf1b+rf0b+nf0r+lf0v/lv4t/Vv6t/Rv6d/Sv6V/S/+W/i39W/q39G/p39K/pX9L/5b+Lf1b+rf0b+nf0r+lf0v/lv4t/Vv6t/Rv6d/Sv6V/S/+W/i39W/q39G/p39K/pX9L/5b+Lf1b+rf0b+nf0r+lf0v/lv4t/Vv6t/Rv6d/Sv6V/S/+W/i39efUAefjD3A==",
  "44100-192":
    "eJzt2rFtAgEQRcFFphBXgLBMAw7IIHQ/FEMBlisgoKsLjip4QmKmgI2eNvrr8nefj9tsrjPzOXO4zGxPP+fj9+5rv/99hude58Wty39dnOTem+SISY6Y5IhJjpjkiEmOmOSISY6Y5IhJjpjkiEmOmOSISY6Y5IitFpqkPDlikiMmOWKSIyY5YpIjJjlikiMmOWKSIyY5YpIjJjlikiMmOWLmcrQ8OWKSIyY5YpIjJjlikiMmOWKSIyY5YpIjJjlikiMmOWKSIyY5YuZytDw5YpIjJjlikiMmOWKSIyY5YpIjJjlikiMmOWKSIyY5YpIjJjlikiNmoUnLkyMmOWKSIyY5YpIjJjlikiMmOWKSIyY5YpIjJjlikiMmOWKSI2YuR8uTIyY5YpIjJjlikiMmOWKSIyY5YpIjJjlikiMmOWKSIyY5YpIjZi5Hy5MjJjlikiMmOWKSIyY5YpIjJjlikiMmOWKSIyY5YpIjJjlikiMmOWIWmrQe3PjtBQ==",
} as const;
export async function syntheticMp3(
  sampleRate: 44100 | 48000 = 48000,
  bitrate: 128 | 192 = 128,
) {
  const bytes = Uint8Array.from(
    atob(MP3[`${sampleRate}-${bitrate}`]),
    (value) => value.charCodeAt(0),
  );
  return new Uint8Array(
    await new Response(
      new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer(),
  );
}
export function syntheticWav(seconds = 3) {
  const bytes = new Uint8Array(44 + Math.round(seconds * 24000) * 2),
    view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) =>
    bytes.set(new TextEncoder().encode(value), offset);
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}
