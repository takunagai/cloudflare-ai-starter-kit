import { createFileRoute } from "@tanstack/react-router";
import { DecisionExample } from "../components/decision-example";

export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "依頼の分類 | Cloudflare AI Starter" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: DecisionExample,
});
