import { createFileRoute } from "@tanstack/react-router";
import { MediaPanel } from "../components/media-panel";
export const Route = createFileRoute("/media")({
  head: () => ({
    meta: [
      { title: "画像と素材 | Cloudflare AI Starter" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MediaPanel,
});
