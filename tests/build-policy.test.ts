import { describe, expect, it, vi } from "vitest";
import {
  assertResolvedBuildTarget,
  prerenderHelpFor,
  resolveBuildTarget,
} from "../build-policy";
import internalProduction from "../examples/presets/internal-production.jsonc?raw";
import internalStaging from "../examples/presets/internal-staging.jsonc?raw";
import local from "../examples/presets/local.jsonc?raw";
import publicProduction from "../examples/presets/public-production.jsonc?raw";
import publicStaging from "../examples/presets/public-staging.jsonc?raw";
import { resolveRuntimePolicy } from "../src/server/runtime-policy";
import publicConfig from "../wrangler.jsonc?raw";

const privateTargets = [
  ["staging-local", "staging", ".wrangler.staging.local.jsonc", "verification"],
  [
    "standard-staging-local",
    "staging",
    ".wrangler.standard-staging.local.jsonc",
    "standard",
  ],
  [
    "e-probe-20261006-local",
    "staging",
    ".wrangler.e-probe-20261006.local.jsonc",
    "standard",
  ],
  [
    "production-local",
    "production",
    ".wrangler.production.local.jsonc",
    undefined,
  ],
] as const;

describe("B-4 build target boundary", () => {
  it("通常stagingだけ/helpをSSRにしてbuild後のprerender待機を避ける", () => {
    expect(
      prerenderHelpFor(
        resolveBuildTarget("standard-staging-local", "staging", () => true),
      ),
    ).toBe(false);
    expect(
      prerenderHelpFor(resolveBuildTarget("production", undefined, () => true)),
    ).toBe(true);
    expect(
      prerenderHelpFor(
        resolveBuildTarget("production-local", "production", () => true),
      ),
    ).toBe(true);
    expect(
      prerenderHelpFor(
        resolveBuildTarget("staging-local", "staging", () => true),
      ),
    ).toBe(true);
  });
  it.each(["development", "production", "test"])(
    "%sは公開local設定を選び、Vite modeをAPP_ENVへ流用しない",
    (mode) => {
      const exists = vi.fn(() => true);
      expect(resolveBuildTarget(mode, undefined, exists)).toEqual({
        configPath: "wrangler.jsonc",
        environment: undefined,
        appEnvironment: "local",
        stagingPolicy: undefined,
      });
      expect(exists).toHaveBeenCalledExactlyOnceWith("wrangler.jsonc");
    },
  );

  it.each(privateTargets)(
    "%sの明示解決先を保持",
    (mode, environment, path, policy) => {
      const exists = vi.fn(() => true);
      expect(resolveBuildTarget(mode, environment, exists)).toEqual({
        configPath: path,
        environment,
        appEnvironment: environment,
        stagingPolicy: policy,
      });
      expect(exists).toHaveBeenCalledExactlyOnceWith(path);
    },
  );

  it.each(privateTargets)(
    "%sの不在時に公開例へ代替しない",
    (mode, environment, path) => {
      const exists = vi.fn(() => false);
      expect(() => resolveBuildTarget(mode, environment, exists)).toThrow(
        /^build_config_missing$/,
      );
      expect(exists).toHaveBeenCalledExactlyOnceWith(path);
    },
  );

  it.each(privateTargets)(
    "%sの環境不一致はファイル照会前に拒否",
    (mode, environment) => {
      for (const invalid of [
        undefined,
        "",
        "unknown",
        "local",
        environment === "staging" ? "production" : "staging",
      ]) {
        const exists = vi.fn(() => true);
        expect(() => resolveBuildTarget(mode, invalid, exists)).toThrow(
          /^build_environment_mismatch$/,
        );
        expect(exists).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["unknown", "staging", "__proto__", "", "../production-local"])(
    "未知mode %sはファイルへ触れず固定エラー",
    (mode) => {
      const exists = vi.fn(() => true);
      expect(() => resolveBuildTarget(mode, "staging", exists)).toThrow(
        /^build_mode_invalid$/,
      );
      expect(exists).not.toHaveBeenCalled();
    },
  );

  it("公開設定の明示環境は旧検証/productionと一致し、未知環境を拒否", () => {
    expect(
      resolveBuildTarget("production", "staging", () => true).stagingPolicy,
    ).toBe("verification");
    expect(
      resolveBuildTarget("development", "production", () => true)
        .appEnvironment,
    ).toBe("production");
    expect(() =>
      resolveBuildTarget("production", "unknown", () => true),
    ).toThrow(/^build_environment_mismatch$/);
  });

  it.each(privateTargets)(
    "preview %sは元設定の不在/環境によってretargetしない",
    (mode, environment, path) => {
      const exists = vi.fn(() => false);
      expect(resolveBuildTarget(mode, "ignored", exists, true)).toMatchObject({
        configPath: path,
        environment,
      });
      expect(exists).not.toHaveBeenCalled();
    },
  );

  it("解決済み環境・env節・APP_ENV・ポリシーを個別に照合", () => {
    const target = resolveBuildTarget(
      "standard-staging-local",
      "staging",
      () => true,
    );
    const valid = {
      environment: "staging",
      environmentDeclared: true,
      appEnvironment: "staging",
      stagingPolicy: "standard",
    };
    expect(() => assertResolvedBuildTarget(target, valid)).not.toThrow();
    for (const patch of [
      { environment: undefined },
      { environment: "production" },
      { environmentDeclared: false },
      { appEnvironment: "production" },
      { appEnvironment: undefined },
      { stagingPolicy: undefined },
      { stagingPolicy: "verification" },
    ])
      expect(() =>
        assertResolvedBuildTarget(target, { ...valid, ...patch }),
      ).toThrow(/^build_target_mismatch$/);
  });

  it("旧modeは省略/verificationだけを維持し、standardへの切替を拒否", () => {
    const target = resolveBuildTarget("staging-local", "staging", () => true);
    for (const stagingPolicy of [undefined, "verification"])
      expect(() =>
        assertResolvedBuildTarget(target, {
          environment: "staging",
          environmentDeclared: true,
          appEnvironment: "staging",
          stagingPolicy,
        }),
      ).not.toThrow();
    expect(() =>
      assertResolvedBuildTarget(target, {
        environment: "staging",
        environmentDeclared: true,
        appEnvironment: "staging",
        stagingPolicy: "standard",
      }),
    ).toThrow(/^build_target_mismatch$/);
  });

  it("productionとlocalへstagingポリシーを混ぜない", () => {
    for (const environment of [undefined, "production"] as const) {
      const target = resolveBuildTarget("production", environment, () => true);
      expect(() =>
        assertResolvedBuildTarget(target, {
          environment,
          environmentDeclared: true,
          appEnvironment: environment ?? "local",
          stagingPolicy: "standard",
        }),
      ).toThrow(/^build_target_mismatch$/);
    }
  });
});

describe("B-4 public presets", () => {
  it.each([
    ["local", local, undefined, "better-auth"],
    ["internal-staging", internalStaging, "staging", "access"],
    ["internal-production", internalProduction, "production", "access"],
    ["public-staging", publicStaging, "staging", "better-auth"],
    ["public-production", publicProduction, "production", "better-auth"],
  ] as const)(
    "%sのOFF/認証/必須DB/公開不能な例を検査",
    (_, text, environment, auth) => {
      // この公開5例は先頭コメント＋JSON。実設定を解析する関数ではない。
      const fragment = JSON.parse(text.slice(text.indexOf("{")));
      const config = environment ? fragment.env[environment] : fragment;
      const policy = resolveRuntimePolicy(config.vars);
      expect(policy.boundary.ok).toBe(true);
      expect(policy.chat).toEqual({
        ok: true,
        value: { mode: environment ? "off" : "local-demo" },
      });
      expect(policy.jev).toEqual({ ok: true, value: { mode: "off" } });
      expect(config.vars.AUTH_MODE).toBe(auth);
      expect(config.vars.JEV_MODE).toBe("off");
      expect(config.vars).not.toHaveProperty("JEV_MODEL");
      expect(config.vars).not.toHaveProperty("TYPESAFE_API_KEY");
      for (const key of [
        "ENABLE_RAG",
        "ENABLE_AGENT",
        "ENABLE_WORKFLOWS",
        "ENABLE_IMAGES",
        "ENABLE_BILLING",
      ])
        expect(config.vars[key]).toBe("false");
      expect(config.workers_dev).toBe(false);
      expect(config.preview_urls).toBe(false);
      expect(config.routes).toEqual([]);
      expect(fragment).not.toHaveProperty("main");
      expect(config.d1_databases).toEqual([
        {
          binding: "DB",
          database_name: `example-${_}`,
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "migrations",
        },
      ]);
      for (const unused of [
        "ai",
        "r2_buckets",
        "workflows",
        "services",
        "queues",
      ])
        expect(config).not.toHaveProperty(unused);
      if (environment) {
        expect(
          new URL(config.vars.APP_ORIGIN).hostname.endsWith(".invalid"),
        ).toBe(true);
        expect(config.vars).not.toHaveProperty("AI_VERIFICATION_ENABLED");
        expect(config.vars).not.toHaveProperty("AI_VERIFICATION_START");
        if (auth === "access") {
          expect(config.vars.ACCESS_AUD).toBe("");
          expect(config.vars.ACCESS_TEAM_DOMAIN).toBe("");
          expect(config).not.toHaveProperty("send_email");
        } else {
          expect(config.vars.EMAIL_FROM).toBe("");
          expect(config.send_email).toEqual([{ name: "EMAIL" }]);
        }
      }
    },
  );

  it("公開wranglerの通常設定とSTAGING_POLICY未指定stagingの閉鎖を保持", () => {
    const config = JSON.parse(publicConfig);
    expect(resolveRuntimePolicy(config.vars).chat).toEqual({
      ok: true,
      value: { mode: "local-demo" },
    });
    expect(resolveRuntimePolicy(config.env.production.vars).chat).toEqual({
      ok: true,
      value: { mode: "off" },
    });
    expect(config.env.staging.vars).not.toHaveProperty(
      "AI_VERIFICATION_ENABLED",
    );
    expect(config.env.staging.vars).not.toHaveProperty("AI_VERIFICATION_START");
    expect(config.env.staging.vars).not.toHaveProperty("AI_MODE");
    expect(config.env.staging.vars).not.toHaveProperty("STAGING_POLICY");
    // 用途別の複製で STAGING_POLICY を明示するまで、stagingは全経路を閉じる。
    expect(resolveRuntimePolicy(config.env.staging.vars).boundary).toEqual({
      ok: false,
      code: "missing_staging_policy",
    });
    for (const vars of [config.vars, config.env.production.vars])
      expect(resolveRuntimePolicy(vars).jev).toEqual({
        ok: true,
        value: { mode: "off" },
      });
  });
});
