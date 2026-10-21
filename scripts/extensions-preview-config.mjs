import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// 全拡張ONの画面確認用wrangler設定を、管理外の .wrangler/ へ生成する。
// localだけで動かし、公開経路・remote binding・実Secretを持たない。
// RAGのAI SearchとJev・Polarのキーは置かないため、それぞれ503の設定不足になる。
export const PORT = "4198";
export const DIRECTORY = ".wrangler/extensions-preview";

const base = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
assert.equal(base.vars?.APP_ENV, "local", "top-level vars must be local");

const config = {
  name: `${base.name}-extensions-preview`,
  main: "../../tests/extensions-preview-worker.ts",
  compatibility_date: base.compatibility_date,
  compatibility_flags: base.compatibility_flags,
  workers_dev: false,
  preview_urls: false,
  send_metrics: false,
  observability: { enabled: false },
  vars: {
    ...base.vars,
    APP_ORIGIN: `http://127.0.0.1:${PORT}`,
    LOCAL_DEMO: "true",
    JEV_MODE: "remote",
    JEV_MODEL: "jev-1.13.0",
    ENABLE_RAG: "true",
    ENABLE_AGENT: "true",
    ENABLE_WORKFLOWS: "true",
    ENABLE_IMAGES: "true",
    ENABLE_MEDIA: "true",
    ENABLE_BILLING: "true",
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: "starter-extensions-preview",
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: "../../migrations",
    },
  ],
  r2_buckets: [
    { binding: "RAG_BUCKET", bucket_name: "starter-extensions-preview-rag" },
    {
      binding: "MEDIA_BUCKET",
      bucket_name: "starter-extensions-preview-media",
    },
  ],
  workflows: [
    {
      binding: "SUMMARY_WORKFLOW",
      name: "starter-extensions-preview-summary",
      class_name: "SummaryWorkflow",
    },
  ],
};
// mediaの許可・確認済みモデルとfalのダミーキーは専用Workerが実行時に足す。
delete config.vars.MEDIA_ALLOWED_MODELS;

mkdirSync(DIRECTORY, { recursive: true });
writeFileSync(
  `${DIRECTORY}/wrangler.jsonc`,
  `${JSON.stringify(config, null, 2)}\n`,
);
console.log(`Wrote ${DIRECTORY}/wrangler.jsonc (port ${PORT}, local only)`);
