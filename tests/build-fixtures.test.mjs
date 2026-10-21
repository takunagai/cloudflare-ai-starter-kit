import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));
const vite = path.join(project, "node_modules/vite/bin/vite.js");
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

// 公開設定/2つのbuildモジュールと合成Workerだけ。実アプリ/実設定/DBの複製ではない。
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "starter-b4-fixture-"));
  await symlink(
    path.join(project, "node_modules"),
    path.join(dir, "node_modules"),
  );
  for (const [source, destination] of [
    ["build-policy.ts", "build-policy.ts"],
    ["vite.config.ts", "starter.config.ts"],
  ])
    await writeFile(
      path.join(dir, destination),
      await readFile(path.join(project, source)),
    );
  await writeFile(path.join(dir, "package.json"), '{"type":"module"}\n');
  await writeFile(
    path.join(dir, "vite.config.ts"),
    `import starter from "./starter.config.ts";
export default (input) => {
  const config = starter(input);
  return { ...config, plugins: config.plugins.slice(0, 1) };
};
`,
  );
  await writeFile(
    path.join(dir, "fixture.mjs"),
    `export default {
  fetch(_request, env) {
    return Response.json({fixture:true, appEnvironment:env.APP_ENV,
      authMode:env.AUTH_MODE, jevOff:env.JEV_MODE === "off",
      keyAbsent:env.TYPESAFE_API_KEY === undefined, db:env.DB !== undefined});
  }
};
`,
  );
  const base = JSON.parse(
    await readFile(path.join(project, "wrangler.jsonc"), "utf8"),
  );
  base.name = "example-b4-fixture";
  base.main = "fixture.mjs";
  return { dir, base };
}

function command(mode, environment, preview = false) {
  // 名前が確定した公開build選択だけを設定。環境一覧の取得/コピーはしない。
  return `unset CLOUDFLARE_ENV; ${environment === undefined ? "" : `CLOUDFLARE_ENV=${quote(environment)} `}CLOUDFLARE_VITE_FORCE_LOCAL=true WRANGLER_LOG_PATH=.wrangler/logs ${preview ? "exec " : ""}${quote(process.execPath)} ${quote(vite)} ${preview ? "preview --host 127.0.0.1 --port 4194 --strictPort" : "build"} --mode ${quote(mode)}`;
}

async function build(dir, mode, environment) {
  try {
    await run("/bin/sh", ["-c", command(mode, environment)], {
      cwd: dir,
      timeout: 60000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { ok: true };
  } catch (error) {
    // 合成buildの出力も丸ごと報告せず、固定コードの判定だけ。
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

async function preview(dir, mode, expected) {
  const child = spawn("/bin/sh", ["-c", command(mode, undefined, true)], {
    cwd: dir,
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  try {
    let response;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) break;
      try {
        response = await fetch("http://127.0.0.1:4194/", {
          signal: AbortSignal.timeout(500),
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(response, "synthetic preview must start");
    assert.deepEqual(await response.json(), {
      fixture: true,
      ...expected,
      jevOff: true,
      keyAbsent: true,
      db: true,
    });
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await exited;
  }
}

for (const [name, environment, auth] of [
  ["local", undefined, "better-auth"],
  ["internal-staging", "staging", "access"],
  ["internal-production", "production", "access"],
  ["public-staging", "staging", "better-auth"],
  ["public-production", "production", "better-auth"],
  ["legacy", "staging", "access"],
]) {
  test(`合成${name}: 実plugin build/flatten/キーなしHTTP起動`, async () => {
    const { dir, base } = await fixture();
    try {
      let config = base;
      if (name !== "legacy") {
        const text = await readFile(
          path.join(project, `examples/presets/${name}.jsonc`),
          "utf8",
        );
        const fragment = JSON.parse(text.slice(text.indexOf("{")));
        config = { ...base, ...fragment };
      }
      // legacyは公開テンプレートのstaging（STAGING_POLICYなし・閉鎖）をそのままbuildする。
      const mode =
        name === "legacy"
          ? "production"
          : environment === "staging"
            ? "standard-staging-local"
            : environment === "production"
              ? "production-local"
              : "production";
      const configPath =
        name === "legacy"
          ? "wrangler.jsonc"
          : environment === "staging"
            ? ".wrangler.standard-staging.local.jsonc"
            : environment === "production"
              ? ".wrangler.production.local.jsonc"
              : "wrangler.jsonc";
      await writeFile(path.join(dir, configPath), JSON.stringify(config));
      assert.equal(
        (await build(dir, mode, environment)).ok,
        true,
        "synthetic build must pass",
      );
      const generated = JSON.parse(
        await readFile(path.join(dir, "dist/ssr/wrangler.json"), "utf8"),
      );
      const source = environment ? config.env[environment] : config;
      assert.equal(generated.vars.APP_ENV, environment ?? "local");
      assert.equal(generated.vars.AUTH_MODE, auth);
      assert.equal(generated.vars.JEV_MODE, "off");
      assert.equal(
        generated.vars.STAGING_POLICY,
        name === "legacy"
          ? undefined
          : environment === "staging"
            ? "standard"
            : undefined,
      );
      assert.equal(generated.d1_databases[0].binding, "DB");
      assert.equal(
        generated.d1_databases[0].database_name,
        source.d1_databases[0].database_name,
      );
      assert.equal(
        generated.d1_databases[0].database_id,
        "00000000-0000-0000-0000-000000000000",
      );
      assert.equal(generated.workers_dev, false);
      assert.equal(generated.preview_urls, false);
      assert.equal(generated.vars.TYPESAFE_API_KEY, undefined);
      await preview(dir, mode, {
        appEnvironment: environment ?? "local",
        authMode: auth,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("実plugin: 未知mode/環境不一致/不在/解決先不一致でbuild停止", async () => {
  const { dir, base } = await fixture();
  try {
    await writeFile(path.join(dir, "wrangler.jsonc"), JSON.stringify(base));
    for (const [mode, environment, code] of [
      ["unknown", undefined, "build_mode_invalid"],
      ["standard-staging-local", undefined, "build_environment_mismatch"],
      ["production-local", "staging", "build_environment_mismatch"],
      ["standard-staging-local", "staging", "build_config_missing"],
      ["production-local", "production", "build_config_missing"],
      ["staging-local", "staging", "build_mode_invalid"],
    ]) {
      const result = await build(dir, mode, environment);
      assert.equal(result.ok, false);
      assert.ok(result.output.includes(code), "expected fixed rejection code");
    }
    await writeFile(
      path.join(dir, ".wrangler.standard-staging.local.jsonc"),
      JSON.stringify(base),
    );
    const wrongPolicy = await build(dir, "standard-staging-local", "staging");
    assert.equal(wrongPolicy.ok, false);
    assert.ok(wrongPolicy.output.includes("build_target_mismatch"));
    delete base.env.staging;
    await writeFile(
      path.join(dir, ".wrangler.standard-staging.local.jsonc"),
      JSON.stringify(base),
    );
    const missingEnvironment = await build(
      dir,
      "standard-staging-local",
      "staging",
    );
    assert.equal(missingEnvironment.ok, false);
    // 欠落env節はWrangler自身の解決エラーでcallbackより先に拒否され得る。
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// dev:extensionsの生成設定。起動は開発者のポートとローカル状態を使うため、ここでは設定だけを検査する。
test("dev:extensions: 全拡張ON・localのみ・キーなしの設定を生成し、local以外は拒否", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "starter-extensions-preview-"));
  const generator = path.join(project, "scripts/extensions-preview-config.mjs");
  try {
    const base = JSON.parse(
      await readFile(path.join(project, "wrangler.jsonc"), "utf8"),
    );
    await writeFile(path.join(dir, "wrangler.jsonc"), JSON.stringify(base));
    await run(process.execPath, [generator], { cwd: dir, timeout: 30000 });
    const config = JSON.parse(
      await readFile(
        path.join(dir, ".wrangler/extensions-preview/wrangler.jsonc"),
        "utf8",
      ),
    );
    assert.equal(config.vars.APP_ENV, "local");
    assert.equal(config.vars.APP_ORIGIN, "http://127.0.0.1:4198");
    for (const flag of [
      "ENABLE_RAG",
      "ENABLE_AGENT",
      "ENABLE_WORKFLOWS",
      "ENABLE_IMAGES",
      "ENABLE_MEDIA",
      "ENABLE_BILLING",
    ])
      assert.equal(config.vars[flag], "true", flag);
    assert.equal(config.vars.JEV_MODE, "remote");
    // falのダミーキーとmediaの許可はWorkerが実行時に足す。Jev・Polarのキーは置かない。
    assert.deepEqual(
      Object.keys(config.vars).filter((name) =>
        /KEY|TOKEN|SECRET|MEDIA_ALLOWED/.test(name),
      ),
      [],
    );
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.equal("routes" in config, false);
    assert.equal("env" in config, false);
    assert.equal("ai_search" in config, false);
    assert.deepEqual(
      config.r2_buckets.map((bucket) => bucket.binding),
      ["RAG_BUCKET", "MEDIA_BUCKET"],
    );
    assert.equal(config.workflows[0].class_name, "SummaryWorkflow");
    // 相対パスは生成先からプロジェクトの実ファイルへ解決する。
    const generated = path.join(project, ".wrangler/extensions-preview");
    await readFile(path.resolve(generated, config.main));
    await readFile(
      path.resolve(
        generated,
        config.d1_databases[0].migrations_dir,
        "0001_auth.sql",
      ),
    );

    base.vars.APP_ENV = "staging";
    await writeFile(path.join(dir, "wrangler.jsonc"), JSON.stringify(base));
    await assert.rejects(
      run(process.execPath, [generator], { cwd: dir, timeout: 30000 }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
