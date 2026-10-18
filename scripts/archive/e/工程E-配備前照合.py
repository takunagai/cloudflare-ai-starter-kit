"""本人の別ターミナルで行う、値を表示しない工程E配備前照合。"""

import json
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    try:
        source = json.loads(
            (root / ".wrangler.standard-staging.local.jsonc").read_text()
        )
        generated = json.loads((root / "dist/server/wrangler.json").read_text())
        expected = source["env"]["staging"]
        variables = generated.get("vars", {})
        databases = generated.get("d1_databases", [])
        buckets = generated.get("r2_buckets", [])
        source_database = expected["d1_databases"][0]
        source_bucket = expected["r2_buckets"][0]
        checks = {
            "worker_matches": generated.get("name") == expected["name"],
            "account_matches": generated.get("account_id") == source["account_id"],
            "standard_staging": variables.get("APP_ENV") == "staging"
            and variables.get("STAGING_POLICY") == "standard",
            "origin_auth_matches": all(
                variables.get(name) == expected["vars"][name]
                for name in [
                    "APP_ORIGIN",
                    "AUTH_MODE",
                    "ACCESS_TEAM_DOMAIN",
                    "ACCESS_AUD",
                ]
            ),
            "all_generation_off": all(
                variables.get(name) == "false"
                for name in [
                    "ENABLE_MEDIA_PROBE",
                    "ENABLE_MEDIA",
                    "ENABLE_IMAGES",
                    "ENABLE_RAG",
                    "ENABLE_AGENT",
                    "ENABLE_WORKFLOWS",
                    "ENABLE_BILLING",
                ]
            ),
            "all_gates_empty": all(
                variables.get(name) == "[]"
                for name in [
                    "AI_ALLOWED_MODELS",
                    "MEDIA_ALLOWED_MODELS",
                    "MEDIA_VERIFIED_IMAGE_MODELS",
                    "MEDIA_VERIFIED_VIDEO_MODELS",
                    "MEDIA_VERIFIED_AUDIO_MODELS",
                ]
            ),
            "ai_jev_off": variables.get("AI_MODE") == "off"
            and variables.get("JEV_MODE") == "off",
            "new_database_matches": len(databases) == 1
            and all(
                databases[0].get(name) == source_database[name]
                for name in ["binding", "database_name", "database_id"]
            ),
            "private_bucket_matches": len(buckets) == 1
            and all(
                buckets[0].get(name) == source_bucket[name]
                for name in ["binding", "bucket_name"]
            ),
            "public_routes_closed": generated.get("routes", []) == []
            and generated.get("workers_dev") is False
            and generated.get("preview_urls") is False,
            "compatibility_unchanged": generated.get("compatibility_date")
            == "2026-09-25"
            and generated.get("compatibility_flags") == ["nodejs_compat"],
            "no_plaintext_fal_key": "FAL_KEY" not in variables,
            "server_entry_exists": (root / "dist/server/index.js").is_file(),
        }
    except Exception:
        # 入力抜粋・パーサーの例外・私有設定値を表示しない。
        print(json.dumps({"all_passed": False, "reason": "read_or_shape_failed"}))
        return 1
    is_passed = all(checks.values())
    print(json.dumps({"checks": checks, "all_passed": is_passed}))
    return 0 if is_passed else 1


if __name__ == "__main__":
    sys.exit(main())
