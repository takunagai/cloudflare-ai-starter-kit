import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allowedJevModelIds,
  type RuntimePolicyInput,
  resolveRuntimePolicy,
  selectableChatModelIds,
} from "../src/server/runtime-policy";

const local = {
  APP_ENV: "local",
  APP_ORIGIN: "http://127.0.0.1:3000",
  LOCAL_DEMO: "false",
} as const;
const production = {
  APP_ENV: "production",
  APP_ORIGIN: "https://app.example.invalid",
  LOCAL_DEMO: "false",
} as const;
const staging = { ...production, APP_ENV: "staging" } as const;
const standard = { ...staging, STAGING_POLICY: "standard" } as const;
const selected = {
  AI_MODE: "selected",
  AI_ALLOWED_MODELS: '["openai/gpt-4.1-mini"]',
} as const;
const remoteJev = { JEV_MODE: "remote", JEV_MODEL: "jev-1.13.0" } as const;

afterEach(() => vi.restoreAllMocks());

describe("runtime policy: environment and legacy boundary", () => {
  it.each([local, standard, production])(
    "通常経路を分離する: $APP_ENV",
    (base) => {
      expect(resolveRuntimePolicy(base)).toEqual({
        boundary: {
          ok: true,
          value: {
            environment: base.APP_ENV,
            requiresCleanLedgerCheck: base.APP_ENV === "staging",
          },
        },
        chat: { ok: true, value: { mode: "off" } },
        jev: { ok: true, value: { mode: "off" } },
      });
    },
  );

  // 旧検証モード（省略時の既定）は廃止。どの組合せでも全経路を固定コードで閉じる。
  it.each([
    [undefined, "missing_staging_policy"],
    ["verification", "invalid_staging_policy"],
  ] as const)("staging %sはfail-closed", (policy, code) => {
    for (const extra of [
      {},
      { AI_VERIFICATION_ENABLED: "false" },
      { AI_VERIFICATION_ENABLED: "true" },
      { AI_VERIFICATION_START: "" },
      selected,
      remoteJev,
    ]) {
      const result = resolveRuntimePolicy({
        ...staging,
        STAGING_POLICY: policy,
        ...extra,
      });
      expect(result.boundary).toEqual({ ok: false, code });
      expect(result.chat).toEqual(result.boundary);
      expect(result.jev).toEqual(result.boundary);
    }
  });

  it.each([undefined, "", "LOCAL", " local", "unknown"])(
    "不正APP_ENVを既定化しない: %s",
    (APP_ENV) => {
      expect(resolveRuntimePolicy({ ...local, APP_ENV }).boundary).toEqual({
        ok: false,
        code: "invalid_application_environment",
      });
    },
  );

  it.each(["", "Standard", " standard", "standard ", "unknown"])(
    "stagingの空/未知policyを拒否: %s",
    (STAGING_POLICY) => {
      expect(
        resolveRuntimePolicy({ ...staging, STAGING_POLICY }).boundary.ok,
      ).toBe(false);
    },
  );
  it.each([local, production])("非stagingで指定を拒否: $APP_ENV", (base) => {
    for (const STAGING_POLICY of ["", "standard", "verification"])
      expect(
        resolveRuntimePolicy({ ...base, STAGING_POLICY }).boundary,
      ).toEqual({
        ok: false,
        code: "invalid_staging_policy",
      });
  });

  it.each([local, standard, production])(
    "旧設定残存を拒否: $APP_ENV",
    (base) => {
      for (const legacy of [
        { AI_VERIFICATION_ENABLED: "true" },
        { AI_VERIFICATION_ENABLED: "" },
        { AI_VERIFICATION_ENABLED: "FALSE" },
        { AI_VERIFICATION_START: " " },
        { AI_VERIFICATION_START: "2026-01-01T00:00:00.000Z" },
      ]) {
        const result = resolveRuntimePolicy({ ...base, ...legacy });
        expect(result.boundary).toEqual({
          ok: false,
          code: "legacy_verification_settings",
        });
        expect(result.chat).toEqual(result.boundary);
        expect(result.jev).toEqual(result.boundary);
      }
      expect(
        resolveRuntimePolicy({
          ...base,
          AI_VERIFICATION_ENABLED: "false",
          AI_VERIFICATION_START: "",
        }).boundary.ok,
      ).toBe(true);
    },
  );

  it.each([
    undefined,
    "",
    "http://example.invalid",
    "http://localhost.example.invalid",
    "http://localhost:3000/",
    "http://localhost:3000/path",
    "http://localhost:3000?x=1",
    "http://localhost:3000#part",
    "http://user:password@localhost:3000",
    "http://127.1:3000",
    "ftp://localhost",
  ])("localの不正originを拒否: %s", (APP_ORIGIN) => {
    expect(resolveRuntimePolicy({ ...local, APP_ORIGIN }).boundary.ok).toBe(
      false,
    );
  });
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:4173",
    "http://[::1]:3000",
  ])("loopback originを受理: %s", (APP_ORIGIN) => {
    expect(resolveRuntimePolicy({ ...local, APP_ORIGIN }).boundary.ok).toBe(
      true,
    );
  });
  it.each([standard, production])(
    "非localは完全なHTTPS origin: $APP_ENV",
    (base) => {
      for (const APP_ORIGIN of [
        "http://app.example.invalid",
        "https://app.example.invalid/",
        "invalid",
      ])
        expect(resolveRuntimePolicy({ ...base, APP_ORIGIN }).boundary.ok).toBe(
          false,
        );
    },
  );
});

describe("runtime policy: explicit chat selection", () => {
  it("旧local固定応答はloopbackかつtrueのときだけ互換", () => {
    expect(resolveRuntimePolicy({ ...local, LOCAL_DEMO: "true" }).chat).toEqual(
      {
        ok: true,
        value: { mode: "local-demo" },
      },
    );
    expect(
      resolveRuntimePolicy({
        ...local,
        LOCAL_DEMO: "true",
        APP_ORIGIN: "https://app.example.invalid",
      }).chat.ok,
    ).toBe(false);
  });

  it.each([local, standard, production])(
    "modeとLOCAL_DEMOの真理表: $APP_ENV",
    (base) => {
      for (const mode of [undefined, "off", "local-demo", "selected"]) {
        for (const demo of [undefined, "", "false", "true", "TRUE", " false"]) {
          const inferredDemo =
            mode === "local-demo" ||
            (mode === undefined && base.APP_ENV === "local" && demo === "true");
          const expected = inferredDemo
            ? base.APP_ENV === "local" && demo === "true"
            : demo === "false";
          const result = resolveRuntimePolicy({
            ...base,
            AI_MODE: mode,
            LOCAL_DEMO: demo,
            AI_ALLOWED_MODELS:
              mode === "selected" ? selected.AI_ALLOWED_MODELS : undefined,
          });
          expect(result.chat.ok, `${mode}/${demo}`).toBe(expected);
        }
      }
    },
  );

  it.each(["", "SELECTED", " selected", "off ", "unknown"])(
    "不正AI_MODE: %s",
    (AI_MODE) => {
      expect(resolveRuntimePolicy({ ...local, AI_MODE }).chat).toEqual({
        ok: false,
        code: "invalid_ai_mode",
      });
    },
  );
  it.each([
    undefined,
    "",
    "[]",
    "null",
    "{}",
    '"openai/gpt-4.1-mini"',
    "[",
    "[1]",
    "[null]",
    "[{}]",
    '["local/demo"]',
    '["jev-1.13.0"]',
    '["unknown"]',
    '["openai/gpt-4.1-mini "]',
    '["openai/gpt-4.1-mini","openai/gpt-4.1-mini"]',
    '["openai/gpt-4.1-mini",false]',
  ])("selectedの不正allowlistを拒否: %s", (AI_ALLOWED_MODELS) => {
    expect(
      resolveRuntimePolicy({ ...local, ...selected, AI_ALLOWED_MODELS }).chat,
    ).toEqual({
      ok: false,
      code: "invalid_allowed_models",
    });
  });
  it("全公開IDを順序どおり受理しJSON外側の空白だけを許容", () => {
    expect(
      resolveRuntimePolicy({
        ...local,
        AI_MODE: "selected",
        AI_ALLOWED_MODELS: ` \n${JSON.stringify(selectableChatModelIds)}\t`,
      }).chat,
    ).toEqual({
      ok: true,
      value: { mode: "selected", allowedModels: selectableChatModelIds },
    });
  });
  it.each([standard, production])(
    "LM Studioの持出しを拒否: $APP_ENV",
    (base) => {
      expect(
        resolveRuntimePolicy({
          ...base,
          AI_MODE: "selected",
          AI_ALLOWED_MODELS: '["lm-studio/local"]',
        }).chat,
      ).toEqual({ ok: false, code: "local_model_forbidden" });
      expect(resolveRuntimePolicy({ ...base, ...selected }).chat.ok).toBe(true);
    },
  );
  it.each(["off", "local-demo"])("%sのallowlistは省略か空配列だけ", (mode) => {
    for (const models of [undefined, "[]", " \n[] "])
      expect(
        resolveRuntimePolicy({
          ...local,
          AI_MODE: mode,
          LOCAL_DEMO: mode === "off" ? "false" : "true",
          AI_ALLOWED_MODELS: models,
        }).chat.ok,
      ).toBe(true);
    for (const models of ["", "null", selected.AI_ALLOWED_MODELS])
      expect(
        resolveRuntimePolicy({
          ...local,
          AI_MODE: mode,
          LOCAL_DEMO: mode === "off" ? "false" : "true",
          AI_ALLOWED_MODELS: models,
        }).chat.ok,
      ).toBe(false);
  });
});

describe("runtime policy: independent Jev contract and pure evaluation", () => {
  it.each([local, standard, production])(
    "JevとチャットのON/OFFは独立: $APP_ENV",
    (base) => {
      for (const chat of [{}, selected]) {
        for (const jev of [{}, remoteJev]) {
          const result = resolveRuntimePolicy({ ...base, ...chat, ...jev });
          expect(result.chat.ok).toBe(true);
          expect(result.jev).toEqual({
            ok: true,
            value:
              "JEV_MODE" in jev
                ? { mode: "remote", model: "jev-1.13.0" }
                : { mode: "off" },
          });
        }
      }
      expect(
        resolveRuntimePolicy({ ...base, ...remoteJev, AI_MODE: "bad" }).jev.ok,
      ).toBe(true);
      expect(
        resolveRuntimePolicy({ ...base, ...selected, JEV_MODE: "bad" }).chat.ok,
      ).toBe(true);
    },
  );
  it.each(["", "REMOTE", " remote", "off ", "unknown"])(
    "不正JEV_MODE: %s",
    (JEV_MODE) => {
      expect(resolveRuntimePolicy({ ...local, JEV_MODE }).jev).toEqual({
        ok: false,
        code: "invalid_jev_mode",
      });
    },
  );
  it.each([
    undefined,
    "",
    "jev-latest",
    "jev-preview",
    "jev-0.0.0",
    "jev-1.13.0 ",
    "openai/gpt-4.1-mini",
  ])("remoteの未許可モデル: %s", (JEV_MODEL) => {
    expect(
      resolveRuntimePolicy({ ...local, JEV_MODE: "remote", JEV_MODEL }).jev,
    ).toEqual({ ok: false, code: "invalid_jev_model" });
  });
  it("offはモデル指定を拒否し、固定版だけをremoteで許可", () => {
    for (const mode of [undefined, "off"])
      for (const model of ["", ...allowedJevModelIds])
        expect(
          resolveRuntimePolicy({ ...local, JEV_MODE: mode, JEV_MODEL: model })
            .jev.ok,
        ).toBe(false);
    expect(resolveRuntimePolicy({ ...local, ...remoteJev }).jev.ok).toBe(true);
  });
  it("入力を変えず、資格情報/bindingを読まず、通信しない", () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected_network"));
    for (const settings of [{}, { ...selected, ...remoteJev }]) {
      const input = Object.freeze({
        ...standard,
        ...settings,
        get TYPESAFE_API_KEY(): never {
          throw new Error("must_not_read_secret");
        },
        get OPENAI_API_KEY(): never {
          throw new Error("must_not_read_secret");
        },
        get AI(): never {
          throw new Error("must_not_read_binding");
        },
        get DB(): never {
          throw new Error("must_not_read_database");
        },
      });
      const result = resolveRuntimePolicy(input);
      expect(result.chat).toEqual({
        ok: true,
        value:
          "AI_MODE" in settings
            ? { mode: "selected", allowedModels: ["openai/gpt-4.1-mini"] }
            : { mode: "off" },
      });
      expect(result.jev).toEqual({
        ok: true,
        value:
          "JEV_MODE" in settings
            ? { mode: "remote", model: "jev-1.13.0" }
            : { mode: "off" },
      });
      expect(resolveRuntimePolicy(input)).toEqual(result);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("拒否結果は入力値やJSON例外を反映しない", () => {
    const sentinel = "TEST_ONLY_DO_NOT_REFLECT";
    const inputs: RuntimePolicyInput[] = [
      { ...local, APP_ENV: sentinel },
      { ...local, APP_ORIGIN: sentinel },
      { ...staging, STAGING_POLICY: sentinel },
      { ...local, AI_MODE: sentinel },
      { ...local, ...selected, AI_ALLOWED_MODELS: sentinel },
      { ...local, JEV_MODE: sentinel },
      { ...local, ...remoteJev, JEV_MODEL: sentinel },
      { ...standard, AI_VERIFICATION_START: sentinel },
    ];
    for (const input of inputs) {
      const result = resolveRuntimePolicy(input);
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(Object.values(result).some((part) => !part.ok)).toBe(true);
    }
  });
});
