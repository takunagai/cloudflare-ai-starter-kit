import { cloudflare } from "@cloudflare/vite-plugin";
import { type ConfigEnv, defineConfig, type UserConfig } from "vite";
import starter from "../vite.config.ts";

// 全拡張ONの画面確認だけの隔離状態。元利用DBやM-5の状態を使わない。
// 設定は scripts/extensions-preview-config.mjs が管理外の .wrangler/ に生成する。
export default defineConfig((input) => {
  const config = (starter as (input: ConfigEnv) => UserConfig)(input);
  return {
    ...config,
    plugins: [
      cloudflare({
        configPath: ".wrangler/extensions-preview/wrangler.jsonc",
        persistState: { path: ".wrangler/extensions-preview/state" },
        inspectorPort: false,
        remoteBindings: false,
        viteEnvironment: { name: "ssr" },
      }),
      ...(config.plugins ?? []).slice(1),
    ],
  };
});
