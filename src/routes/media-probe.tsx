import { createFileRoute } from "@tanstack/react-router";
import { MediaProbe } from "../components/media-probe";

export const Route = createFileRoute("/media-probe")({
  head: () => ({
    meta: [
      { title: "限定接続の確認 | Cloudflare AI Starter" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: MediaProbe,
});
