export const IMAGE_ENDPOINTS = [
  "openai/gpt-image-2.5/sunburst/text-to-image",
  "openai/gpt-image-2.5/sunburst/edit",
  "openai/gpt-image-2.5/flare/text-to-image",
  "openai/gpt-image-2.5/flare/edit",
] as const;
export const IMAGE_PRESETS = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1536, height: 1024 },
  portrait: { width: 1024, height: 1536 },
  widescreen: { width: 1536, height: 864 },
  vertical: { width: 864, height: 1536 },
} as const;
export const IMAGE_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
