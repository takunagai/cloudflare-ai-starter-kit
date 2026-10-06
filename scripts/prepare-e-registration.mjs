import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createServer } from "vite";

const privateDirectory = ".wrangler/e-20261006";
const migrationPath = `${privateDirectory}/migrations/0013_e_register_run.sql`;
const manifestPath = `${privateDirectory}/run-manifest.json`;

async function readInput() {
  let source = "";
  for await (const chunk of process.stdin) {
    source += chunk;
    if (source.length > 4096) throw new Error("input_too_large");
  }
  return JSON.parse(source);
}

function validate(input) {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).sort().join(",") !== "origin,ownerId,startUtc" ||
    typeof input.origin !== "string" ||
    typeof input.ownerId !== "string" ||
    typeof input.startUtc !== "string" ||
    !/^access:[a-z0-9.-]+:[A-Za-z0-9_-]{8,128}$/.test(input.ownerId) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.startUtc)
  )
    throw new Error("input_invalid");
  const origin = new URL(input.origin);
  const workerName = origin.hostname.split(".")[0];
  const start = Date.parse(input.startUtc);
  if (
    origin.protocol !== "https:" ||
    !/^ai-starter-e-20261006-[a-z0-9]+$/.test(workerName) ||
    !origin.hostname.startsWith(`${workerName}.`) ||
    origin.hostname.split(".").length < 3 ||
    origin.port ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !Number.isFinite(start) ||
    start < Date.now() + 60_000 ||
    start > Date.now() + 86_400_000
  )
    throw new Error("target_or_window_invalid");
  return { origin: origin.origin, start, end: start + 1_800_000 };
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function exclusiveWrite(path, content) {
  const descriptor = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await descriptor.writeFile(content);
  } finally {
    await descriptor.close();
  }
}

try {
  const input = await readInput();
  const target = validate(input);
  const server = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  let contract;
  try {
    const permit = await server.ssrLoadModule(
      "/src/server/media/probe-permit.ts",
    );
    const catalog = await server.ssrLoadModule("/src/server/media/catalog.ts");
    const service = await server.ssrLoadModule("/src/server/media/service.ts");
    const requestKey = `${input.startUtc.slice(0, 10)}:${crypto.randomUUID()}`;
    const inputHash = await service.inputHash(
      catalog.normalizeMedia(permit.probeInput(requestKey)),
    );
    if (!/^[a-f0-9]{64}$/.test(inputHash)) throw new Error("hash_invalid");
    contract = {
      approvalVersion: permit.PROBE_APPROVAL_VERSION,
      model: permit.PROBE_MODEL,
      ownerId: input.ownerId,
      origin: target.origin,
      start: target.start,
      end: target.end,
      requestKey,
      inputHash,
    };
  } finally {
    await server.close();
  }
  if (process.argv[2] === "--verify-only") {
    process.stdout.write(
      `${JSON.stringify({ valid: true, hashReady: true })}\n`,
    );
  } else if (process.argv.length !== 2) {
    throw new Error("argument_invalid");
  } else {
    for (const directory of [
      privateDirectory,
      `${privateDirectory}/migrations`,
    ]) {
      const metadata = await lstat(directory);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid() ||
        (metadata.mode & 0o777) !== 0o700
      )
        throw new Error("private_directory_invalid");
    }
    const sql = `${[
      `INSERT INTO media_probe_run(id,approval_version,owner_id,app_origin,started_at,expires_at) VALUES(1,${quote(contract.approvalVersion)},${quote(contract.ownerId)},${quote(contract.origin)},${contract.start},${contract.end});`,
      `INSERT INTO media_probe_slots(run_id,slot,request_key,input_hash) VALUES(1,1,${quote(contract.requestKey)},${quote(contract.inputHash)});`,
    ].join("\n")}\n`;
    await exclusiveWrite(manifestPath, `${JSON.stringify(contract)}\n`);
    await exclusiveWrite(migrationPath, sql);
    process.stdout.write(
      `${JSON.stringify({ prepared: true, migrationCount: 1 })}\n`,
    );
  }
} catch {
  process.stdout.write(
    `${JSON.stringify({ prepared: false, reason: "input_or_file_failed" })}\n`,
  );
  process.exitCode = 1;
}
