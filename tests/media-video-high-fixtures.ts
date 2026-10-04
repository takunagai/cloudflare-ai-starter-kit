import landscape768 from "./fixtures/media/high-768-landscape";
import portrait768 from "./fixtures/media/high-768-portrait";
import landscape1080 from "./fixtures/media/high-1080-landscape";
import portrait1080 from "./fixtures/media/high-1080-portrait";

export const HIGH_PROFILE_VIDEOS = [
  {
    name: "768P landscape",
    bytes: landscape768,
    width: 1366,
    height: 768,
    resolution: "768P",
    aspectRatio: "16:9",
  },
  {
    name: "768P portrait",
    bytes: portrait768,
    width: 768,
    height: 1366,
    resolution: "768P",
    aspectRatio: "9:16",
  },
  {
    name: "1080P landscape",
    bytes: landscape1080,
    width: 1920,
    height: 1080,
    resolution: "1080P",
    aspectRatio: "16:9",
  },
  {
    name: "1080P portrait",
    bytes: portrait1080,
    width: 1080,
    height: 1920,
    resolution: "1080P",
    aspectRatio: "9:16",
  },
] as const;
