import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

// 公開テンプレートだけから新しい隔離ローカルfixture設定を作る。既存状態を上書きしない。
const SOURCE = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
for (const [folder, main, name] of [
  [
    "e-preview",
    "../../tests/media-probe-preview-worker.ts",
    "example-e-probe-fixture",
  ],
  ["e-off", "../../src/server.ts", "example-e-probe-off"],
]) {
  const root = `.wrangler/${folder}`;
  if (
    await stat(root).then(
      () => true,
      () => false,
    )
  )
    throw new Error(
      "Fixture directory already exists; do not reset consumed state.",
    );
  await mkdir(root, { recursive: true });
  const { env: _environment, $schema: _schema, ...configuration } = SOURCE;
  configuration.name = name;
  configuration.main = main;
  configuration.d1_databases = [
    {
      binding: "DB",
      database_name: name,
      database_id: "00000000-0000-0000-0000-000000000000",
      migrations_dir: "../../migrations",
    },
  ];
  if (folder === "e-preview")
    configuration.r2_buckets = [
      { binding: "MEDIA_BUCKET", bucket_name: "example-e-probe-fixture" },
    ];
  await writeFile(
    `${root}/wrangler.jsonc`,
    `${JSON.stringify(configuration, null, 2)}\n`,
    { flag: "wx" },
  );
}
console.log(
  "Created new local E fixture configurations; remote resources and existing state unchanged.",
);
