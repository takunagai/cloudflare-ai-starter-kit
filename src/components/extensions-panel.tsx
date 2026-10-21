import { useState } from "react";
import type { Features, Model } from "./api-client";
import { AgentPanel } from "./extensions/agent-panel";
import { BillingPanel } from "./extensions/billing-panel";
import { ImagesPanel } from "./extensions/images-panel";
import { RagPanel } from "./extensions/rag-panel";
import { WorkflowsPanel } from "./extensions/workflows-panel";

// mediaとdecisionsは専用画面を持つため、このパネルのタブにしない。
type PanelFeature = Exclude<keyof Features, "media" | "decisions">;

export function ExtensionsPanel({
  features,
  models,
  modelId,
  revision,
}: {
  features: Features;
  models: Model[];
  modelId: string;
  revision: number;
}) {
  const [active, setActive] = useState<PanelFeature | null>(null);
  const labels: Record<PanelFeature, string> = {
    rag: "資料",
    agent: "承認とメモ",
    workflows: "長時間処理",
    images: "画像生成",
    billing: "プラン",
  };
  const enabled = (Object.keys(labels) as PanelFeature[]).filter(
    (key) => features[key],
  );
  if (!enabled.length) return null;
  return (
    <section className="extensions">
      <h2>必要な仕事を、ここから</h2>
      <div className="extension-tabs">
        {enabled.map((key) => (
          <button
            type="button"
            key={key}
            className={active === key ? "" : "secondary"}
            aria-pressed={active === key}
            onClick={() => setActive(active === key ? null : key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      {active && features[active] && (
        <div className="extension-body">
          {active === "rag" && <RagPanel />}
          {active === "agent" && <AgentPanel revision={revision} />}
          {active === "workflows" && (
            <WorkflowsPanel models={models} modelId={modelId} />
          )}
          {active === "images" && <ImagesPanel />}
          {active === "billing" && <BillingPanel />}
        </div>
      )}
    </section>
  );
}
