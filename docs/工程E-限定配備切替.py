"""本人の別ターミナル用。専用入口とprobe ON/OFFだけを切り替える。"""

import argparse
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["on", "off"])
    parser.add_argument("--verify-generated", action="store_true")
    parser.add_argument("--build-and-verify", action="store_true")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    path = root / ".wrangler.standard-staging.local.jsonc"
    try:
        metadata = path.lstat()
        if (
            stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise ValueError("metadata_mismatch")
        source = json.loads(path.read_text())
        staging = source["env"]["staging"]
        variables = staging["vars"]
        origin = urlparse(variables["APP_ORIGIN"])
        routes = [{"pattern": origin.hostname, "custom_domain": True}]
        if (
            origin.scheme != "https"
            or not origin.hostname
            or origin.username
            or origin.password
            or origin.port
            or origin.path not in ["", "/"]
            or origin.query
            or origin.fragment
            or variables["APP_ENV"] != "staging"
            or variables["STAGING_POLICY"] != "standard"
            or variables["AUTH_MODE"] != "access"
            or variables["LOCAL_DEMO"] != "false"
            or variables["MEDIA_PROBE_APPROVAL_VERSION"] != "e-sunburst-20261005-v1"
            or variables["ENABLE_MEDIA_PROBE"] not in ["false", "true"]
            or any(
                variables.get(name) != "false"
                for name in [
                    "ENABLE_MEDIA", "ENABLE_IMAGES", "ENABLE_RAG", "ENABLE_AGENT",
                    "ENABLE_WORKFLOWS", "ENABLE_BILLING",
                ]
            )
            or any(
                variables.get(name) != "[]"
                for name in [
                    "AI_ALLOWED_MODELS", "MEDIA_ALLOWED_MODELS",
                    "MEDIA_VERIFIED_IMAGE_MODELS", "MEDIA_VERIFIED_VIDEO_MODELS",
                    "MEDIA_VERIFIED_AUDIO_MODELS",
                ]
            )
            or variables["AI_MODE"] != "off"
            or variables["JEV_MODE"] != "off"
            or "FAL_KEY" in variables
            or staging.get("routes", []) not in [[], routes]
            or staging.get("workers_dev", source.get("workers_dev")) is not False
            or staging.get("preview_urls", source.get("preview_urls")) is not False
            or len(staging["d1_databases"]) != 1
            or staging["d1_databases"][0]["binding"] != "DB"
            or staging["d1_databases"][0]["migrations_dir"] != ".wrangler/e-live/migrations"
            or len(staging["r2_buckets"]) != 1
            or staging["r2_buckets"][0]["binding"] != "MEDIA_BUCKET"
        ):
            raise ValueError("target_shape_mismatch")
        enabled = "true" if arguments.mode == "on" else "false"
        if arguments.verify_generated:
            generated = json.loads((root / "dist/server/wrangler.json").read_text())
            checks = {
                "worker_matches": generated.get("name") == staging["name"],
                "account_matches": generated.get("account_id") == source["account_id"],
                "variables_match": generated.get("vars") == variables,
                "probe_mode_matches": variables["ENABLE_MEDIA_PROBE"] == enabled,
                "database_matches": len(generated.get("d1_databases", [])) == 1
                and all(
                    generated["d1_databases"][0].get(name) == staging["d1_databases"][0][name]
                    for name in ["binding", "database_name", "database_id"]
                ),
                "bucket_matches": len(generated.get("r2_buckets", [])) == 1
                and all(
                    generated["r2_buckets"][0].get(name) == staging["r2_buckets"][0][name]
                    for name in ["binding", "bucket_name"]
                ),
                "dedicated_route_matches": staging.get("routes") == routes
                and generated.get("routes") == routes,
                "alternate_hosts_closed": generated.get("workers_dev") is False
                and generated.get("preview_urls") is False,
                "compatibility_matches": generated.get("compatibility_date") == "2026-09-25"
                and generated.get("compatibility_flags") == ["nodejs_compat"],
                "server_entry_exists": (root / "dist/server/index.js").is_file(),
            }
            passed = all(checks.values())
            print(json.dumps({"checks": checks, "all_passed": passed}))
            return 0 if passed else 1
        staging["routes"] = routes
        variables["ENABLE_MEDIA_PROBE"] = enabled
        if arguments.build_and_verify:
            node = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True)
            pnpm = subprocess.run(["pnpm", "--version"], capture_output=True, text=True, check=True)
            if node.stdout.strip() != "v26.10.0" or pnpm.stdout.strip() != "12.6.0":
                raise ValueError("pinned_runtime_mismatch")
        path.write_text(json.dumps(source, indent=2) + "\n")
        print(json.dumps({"source_prepared": True, "mode": arguments.mode, "deploy_performed": False}))
        if arguments.build_and_verify:
            log_path = root / ".wrangler/e-live/final-off-build.log"
            descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, "wb") as log:
                build = subprocess.run(
                    ["/bin/sh", "-c", "CLOUDFLARE_ENV=staging WRANGLER_LOG_PATH=.wrangler/e-live/logs pnpm build --mode standard-staging-local"],
                    cwd=root, stdout=log, stderr=subprocess.STDOUT,
                )
            if build.returncode != 0:
                print(json.dumps({"build_succeeded": False, "deploy_performed": False}))
                return 1
            return subprocess.run(
                [sys.executable, str(Path(__file__).resolve()), arguments.mode, "--verify-generated"],
                cwd=root,
            ).returncode
        return 0
    except Exception:
        # 私有設定値・入力抜粋・例外内容を表示しない。
        print(json.dumps({"source_prepared": False, "reason": "read_or_shape_failed"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
