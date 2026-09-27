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
        r2Buckets: ["RAG_BUCKET"],
        workflows: {
          SUMMARY_WORKFLOW: {
            name: "summary-test",
            className: "SummaryWorkflow",
          },
        },
      },
    })),
  ],
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["./tests/setup.ts"] },
});
