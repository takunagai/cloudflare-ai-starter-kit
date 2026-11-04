import { describe, expect, it } from "vitest";
import {
  CAMERA_PRESETS,
  type CameraKeyframe,
  isCameraValid,
} from "../src/lib/media-video-options";

function frame(
  time: number,
  values: Partial<Omit<CameraKeyframe, "time">> = {},
): CameraKeyframe {
  return { time, azimuth: 0, elevation: 0, distance: 1, ...values };
}

describe("カメラのキーフレーム検証", () => {
  it.each(Object.entries(CAMERA_PRESETS))(
    "既定のプリセットを受け付ける: %s",
    (_name, keyframes) => {
      expect(isCameraValid(keyframes)).toBe(true);
    },
  );

  it("境界値ちょうどを受け付ける", () => {
    expect(
      isCameraValid([
        frame(0, { elevation: -90, distance: 0.1 }),
        frame(0.5, { azimuth: 360, elevation: 90, distance: 10 }),
        frame(1, { azimuth: 0 }),
      ]),
    ).toBe(true);
    expect(
      isCameraValid(
        Array.from({ length: 12 }, (_, index) => frame(index / 11)),
      ),
    ).toBe(true);
  });

  it.each([
    ["1個だけ", [frame(0)]],
    ["13個", Array.from({ length: 13 }, (_, index) => frame(index / 12))],
    ["0から始まらない", [frame(0.1), frame(1)]],
    ["1で終わらない", [frame(0), frame(0.9)]],
    ["時刻が増えない", [frame(0), frame(0.5), frame(0.5), frame(1)]],
    ["時刻が戻る", [frame(0), frame(0.6), frame(0.4), frame(1)]],
    ["範囲外の時刻", [frame(0), frame(1.5), frame(1)]],
    ["仰角が-90未満", [frame(0, { elevation: -90.1 }), frame(1)]],
    ["仰角が90超", [frame(0), frame(1, { elevation: 90.1 })]],
    ["距離が0.1未満", [frame(0, { distance: 0.09 }), frame(1)]],
    ["距離が10超", [frame(0), frame(1, { distance: 10.1 })]],
    ["有限でない値", [frame(0, { azimuth: Number.NaN }), frame(1)]],
    [
      "無限大の値",
      [frame(0), frame(1, { distance: Number.POSITIVE_INFINITY })],
    ],
  ])("不正なキーフレームを拒否する: %s", (_name, keyframes) => {
    expect(isCameraValid(keyframes)).toBe(false);
  });

  it("累計の回転量は720度まで受け付け、超えたら拒否する", () => {
    expect(
      isCameraValid([
        frame(0),
        frame(0.5, { azimuth: 360 }),
        frame(1, { azimuth: 0 }),
      ]),
    ).toBe(true);
    expect(
      isCameraValid([
        frame(0),
        frame(0.5, { azimuth: 360 }),
        frame(1, { azimuth: -0.1 }),
      ]),
    ).toBe(false);
  });
});
