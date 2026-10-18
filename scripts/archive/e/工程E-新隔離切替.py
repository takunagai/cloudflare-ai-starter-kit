"""本人が新隔離WorkerのprobeだけをON/OFFにする。配備は行わない。"""

import argparse
import json
import os
import stat
import sys
from pathlib import Path
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("on", "off"))
    parser.add_argument("--verify-generated", action="store_true")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    path = root / ".wrangler.e-probe-20261006.local.jsonc"
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
        route = [{"pattern": origin.hostname, "custom_domain": True}]
        expected = "true" if arguments.mode == "on" else "false"
        if (
            origin.scheme != "https"
            or not origin.hostname
            or origin.username
            or origin.password
            or origin.port
            or origin.path not in ("", "/")
            or origin.query
            or origin.fragment
            or variables["APP_ENV"] != "staging"
            or variables["STAGING_POLICY"] != "standard"
            or variables["AUTH_MODE"] != "access"
            or variables["MEDIA_PROBE_APPROVAL_VERSION"] != "e-sunburst-20261005-v1"
            or variables["ENABLE_MEDIA_PROBE"] not in ("false", "true")
            or any(
                variables.get(name) != "false"
                for name in (
                    "ENABLE_MEDIA", "ENABLE_IMAGES", "ENABLE_RAG", "ENABLE_AGENT",
                    "ENABLE_WORKFLOWS", "ENABLE_BILLING",
                )
            )
            or any(
                variables.get(name) != "[]"
                for name in (
                    "AI_ALLOWED_MODELS", "MEDIA_ALLOWED_MODELS",
                    "MEDIA_VERIFIED_IMAGE_MODELS", "MEDIA_VERIFIED_VIDEO_MODELS",
                    "MEDIA_VERIFIED_AUDIO_MODELS",
                )
            )
            or variables["AI_MODE"] != "off"
            or variables["JEV_MODE"] != "off"
            or "FAL_KEY" in variables
            or staging.get("routes", []) not in ([], route)
            or staging.get("workers_dev", source.get("workers_dev")) is not False
            or staging.get("preview_urls", source.get("preview_urls")) is not False
            or len(staging["d1_databases"]) != 1
            or staging["d1_databases"][0]["binding"] != "DB"
            or staging["d1_databases"][0]["migrations_dir"]
            != ".wrangler/e-20261006/migrations"
            or len(staging["r2_buckets"]) != 1
            or staging["r2_buckets"][0]["binding"] != "MEDIA_BUCKET"
        ):
            raise ValueError("target_shape_mismatch")
        if arguments.verify_generated:
            generated = json.loads((root / "dist/server/wrangler.json").read_text())
            expected_routes = staging.get("routes", [])
            checks = {
                "worker_matches": generated.get("name") == staging["name"],
                "account_matches": generated.get("account_id") == source["account_id"],
                "probe_mode_matches": variables["ENABLE_MEDIA_PROBE"] == expected
                and generated.get("vars") == variables,
                "database_matches": len(generated.get("d1_databases", [])) == 1
                and all(
                    generated["d1_databases"][0].get(name)
                    == staging["d1_databases"][0][name]
                    for name in ("binding", "database_name", "database_id")
                ),
                "bucket_matches": len(generated.get("r2_buckets", [])) == 1
                and all(
                    generated["r2_buckets"][0].get(name)
                    == staging["r2_buckets"][0][name]
                    for name in ("binding", "bucket_name")
                ),
                "dedicated_route_matches": expected_routes in ([], route)
                and (expected == "false" or expected_routes == route)
                and generated.get("routes", []) == expected_routes,
                "alternate_hosts_closed": generated.get("workers_dev") is False
                and generated.get("preview_urls") is False,
                "server_entry_exists": (root / "dist/server/index.js").is_file(),
            }
            passed = all(checks.values())
            print(json.dumps({"checks": checks, "all_passed": passed}))
            return 0 if passed else 1
        staging["routes"] = route
        variables["ENABLE_MEDIA_PROBE"] = expected
        path.write_text(json.dumps(source, indent=2) + "\n")
        print(json.dumps({"source_prepared": True, "deploy_performed": False}))
        return 0
    except Exception:
        print(json.dumps({"source_prepared": False, "deploy_performed": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
