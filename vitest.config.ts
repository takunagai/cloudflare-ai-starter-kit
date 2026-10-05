import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      // APIは実workerdで検証。TanStackのSSR/ルーティングはbuild後のsmokeで検証する。
      main: "./tests/extension-worker.ts",
      remoteBindings: false,
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          ENABLE_WORKFLOWS: "true",
        },
        r2Buckets: ["RAG_BUCKET", "MEDIA_BUCKET"],
        d1Databases: [
          "DECISION_MIGRATION_DB",
          "DECISION_UPGRADE_DB",
          "MEDIA_MIGRATION_DB",
          "MEDIA_UPGRADE_DB",
          "MEDIA_FAILURE_DB",
          "MEDIA_ASSET_UPGRADE_DB",
          "MEDIA_ASSET_FAILURE_DB",
          "MEDIA_VIDEO_UPGRADE_DB",
          "MEDIA_VIDEO_FAILURE_DB",
          "PROBE_MIGRATION_DB",
          "PROBE_UPGRADE_DB",
          "PROBE_FAILURE_DB",
        ],
        workflows: {
          SUMMARY_WORKFLOW: {
            name: "summary-test",
            className: "SummaryWorkflow",
          },
        },
      },
    })),
  ],
  // WASMとworkerdのisolateを同時に増やし過ぎず、全試験を実行する。
  test: {
    maxWorkers: 4,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
