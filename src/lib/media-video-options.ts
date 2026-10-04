export const VIDEO_ENDPOINTS = [
  "minimax/h3-max/text-to-video",
  "minimax/h3-max/image-to-video",
  "minimax/h3-max/reference-to-video",
  "minimax/h3-max/camera-controls",
] as const;
export const VIDEO_RATIOS = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;
export type CameraKeyframe = {
  time: number;
  azimuth: number;
  elevation: number;
  distance: number;
};
export function isCameraValid(keyframes: CameraKeyframe[]) {
  if (
    keyframes.length < 2 ||
    keyframes.length > 12 ||
    keyframes[0].time !== 0 ||
    keyframes.at(-1)?.time !== 1
  )
    return false;
  let rotation = 0;
  for (const [index, frame] of keyframes.entries()) {
    if (
      ![frame.time, frame.azimuth, frame.elevation, frame.distance].every(
        Number.isFinite,
      ) ||
      frame.time < 0 ||
      frame.time > 1 ||
      frame.elevation < -90 ||
      frame.elevation > 90 ||
      frame.distance < 0.1 ||
      frame.distance > 10
    )
      return false;
    if (index) {
      if (frame.time <= keyframes[index - 1].time) return false;
      rotation += Math.abs(frame.azimuth - keyframes[index - 1].azimuth);
    }
  }
  return rotation <= 720;
}
export const CAMERA_PRESETS: Record<string, CameraKeyframe[]> = {
  静止: [
    { time: 0, azimuth: 0, elevation: 0, distance: 1 },
    { time: 1, azimuth: 0, elevation: 0, distance: 1 },
  ],
  接近: [
    { time: 0, azimuth: 0, elevation: 0, distance: 1 },
    { time: 1, azimuth: 0, elevation: 0, distance: 0.7 },
  ],
  旋回: [
    { time: 0, azimuth: 0, elevation: 0, distance: 1 },
    { time: 1, azimuth: 90, elevation: 0, distance: 1 },
  ],
};
