// B-4: mode/環境の純粋な判定。実設定・Secret・環境一覧を読み取らない。
export type BuildTarget = Readonly<{
  configPath: string;
  environment: "staging" | "production" | undefined;
  appEnvironment: "local" | "staging" | "production";
  // closedはSTAGING_POLICYを書かない公開テンプレートのstaging。実行時に全経路を閉じる。
  // 旧検証用のstaging-local modeは2026-10-19に旧stagingの削除とあわせて廃止した。
  stagingPolicy: "closed" | "standard" | undefined;
}>;

// 通常stagingは/helpをSSRにする。複製先の実設定ON buildで/help事前生成後に
// build processが終了しない事例があったため（2026-10-06、根因未確定）。
// local/productionの事前生成は維持する。
export function prerenderHelpFor(target: BuildTarget): boolean {
  return target.stagingPolicy !== "standard";
}

export function resolveBuildTarget(
  mode: string,
  environment: string | undefined,
  configExists: (path: string) => boolean,
  preview = false,
): BuildTarget {
  let configPath = "wrangler.jsonc";
  let requiredEnvironment: "staging" | "production" | undefined;
  let stagingPolicy: "closed" | "standard" | undefined;
  switch (mode) {
    case "development":
    case "production":
    case "test":
      break;
    case "standard-staging-local":
      configPath = ".wrangler.standard-staging.local.jsonc";
      requiredEnvironment = "staging";
      stagingPolicy = "standard";
      break;
    case "e-probe-20261006-local":
      configPath = ".wrangler.e-probe-20261006.local.jsonc";
      requiredEnvironment = "staging";
      stagingPolicy = "standard";
      break;
    case "production-local":
      configPath = ".wrangler.production.local.jsonc";
      requiredEnvironment = "production";
      break;
    default:
      throw new Error("build_mode_invalid");
  }

  // previewは既にflattenされた成果物を使う。環境・元設定で再targetしない。
  const selectedEnvironment = preview ? requiredEnvironment : environment;
  if (
    (!preview &&
      requiredEnvironment !== undefined &&
      environment !== requiredEnvironment) ||
    (selectedEnvironment !== undefined &&
      selectedEnvironment !== "staging" &&
      selectedEnvironment !== "production")
  )
    throw new Error("build_environment_mismatch");
  if (!preview && !configExists(configPath))
    throw new Error("build_config_missing");

  return {
    configPath,
    environment: selectedEnvironment,
    appEnvironment: selectedEnvironment ?? "local",
    stagingPolicy:
      selectedEnvironment === "staging"
        ? (stagingPolicy ?? "closed")
        : undefined,
  };
}

export function assertResolvedBuildTarget(
  target: BuildTarget,
  resolved: Readonly<{
    environment?: string;
    environmentDeclared: boolean;
    appEnvironment: unknown;
    stagingPolicy: unknown;
  }>,
): void {
  // pluginの最終解決結果も照合。欠落env節のtop-levelへの代替を拒否する。
  if (
    resolved.environment !== target.environment ||
    (target.environment !== undefined && !resolved.environmentDeclared) ||
    resolved.appEnvironment !== target.appEnvironment ||
    (target.stagingPolicy === "closed"
      ? resolved.stagingPolicy !== undefined
      : resolved.stagingPolicy !== target.stagingPolicy)
  )
    throw new Error("build_target_mismatch");
}
