import { mkdir, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderD1Wire } from "./d1-wire.ts";

const sourceDirectory = "migrations";
const targetDirectory = ".wrangler/e-20261006/migrations";
const names = (await readdir(sourceDirectory))
  // 閉鎖済みの10月6日runは0012まで。後続の公開migrationを混ぜない。
  .filter(
    (name) => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0, 4)) <= 12,
  )
  .sort();

if (
  names.length !== 12 ||
  names.some((name, index) => Number(name.slice(0, 4)) !== index + 1)
)
  throw new Error("migration_set_invalid");

const files = await Promise.all(
  names.map(async (name) => ({
    name,
    wire: renderD1Wire(await readFile(join(sourceDirectory, name), "utf8")),
  })),
);

if (process.argv[2] === "--verify-only") {
  process.stdout.write(
    JSON.stringify({ sourceReady: true, fileCount: files.length }) + "\n",
  );
} else if (process.argv.length !== 2) {
  throw new Error("argument_invalid");
} else {
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  for (const file of files) {
    const descriptor = await open(
      join(targetDirectory, file.name),
      "wx",
      0o600,
    );
    try {
      await descriptor.writeFile(file.wire);
    } finally {
      await descriptor.close();
    }
  }
  process.stdout.write(
    JSON.stringify({ wireReady: true, fileCount: files.length }) + "\n",
  );
}
