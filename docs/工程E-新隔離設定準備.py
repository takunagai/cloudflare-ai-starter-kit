"""本人が別ターミナルで新しい工程E用の管理外OFF設定を作る。"""

import getpass
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


CONFIG_NAME = ".wrangler.e-probe-20261006.local.jsonc"

def discover(root):
    previous_path = root / ".wrangler.standard-staging.local.jsonc"
    metadata = previous_path.lstat()
    if (
        stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise ValueError("previous_config_invalid")
    previous = json.loads(previous_path.read_text())
    previous_origin = urlparse(previous["env"]["staging"]["vars"]["APP_ORIGIN"])
    if not previous_origin.hostname or "." not in previous_origin.hostname:
        raise ValueError("previous_origin_invalid")
    domain = previous_origin.hostname.split(".", 1)[1]
    arguments = ("--config", str(previous_path), "--env", "staging")
    database_result = subprocess.run(
        ["pnpm", "exec", "wrangler", "d1", "list", "--json", *arguments],
        cwd=root, capture_output=True, text=True, check=True, timeout=30,
    )
    databases = json.loads(database_result.stdout)
    matches = [
        database for database in databases
        if re.fullmatch(r"ai-starter-e-20261006-[a-z0-9]+-db", database["name"])
    ]
    if len(matches) != 1:
        raise ValueError("new_database_not_unique")
    database = matches[0]
    worker = database["name"][:-3]
    bucket_result = subprocess.run(
        ["pnpm", "exec", "wrangler", "r2", "bucket", "list", *arguments],
        cwd=root, capture_output=True, text=True, check=True, timeout=30,
    )
    buckets = re.findall(r"^name:\s*(\S+)\s*$", bucket_result.stdout, re.MULTILINE)
    if buckets.count(worker + "-media") != 1:
        raise ValueError("new_bucket_not_found")
    return {
        "ACCOUNT_ID": previous["account_id"],
        "WORKER_NAME": worker,
        "HOST_DOMAIN": domain,
        "ACCESS_TEAM_DOMAIN": previous["env"]["staging"]["vars"]["ACCESS_TEAM_DOMAIN"],
        "DATABASE_ID": database["uuid"],
    }


def valid(values):
    origin = urlparse(
        "https://" + values["WORKER_NAME"] + "." + values["HOST_DOMAIN"]
    )
    return (
        all(values.values())
        and re.fullmatch(r"[0-9a-f]{32}", values["ACCOUNT_ID"]) is not None
        and re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", values["WORKER_NAME"])
        is not None
        and re.fullmatch(r"[0-9a-f-]{36}", values["DATABASE_ID"]) is not None
        and re.fullmatch(r"[a-z0-9.-]+", values["HOST_DOMAIN"])
        is not None
        and re.fullmatch(r"[a-zA-Z0-9_-]{16,128}", values["ACCESS_AUD"])
        is not None
        and re.fullmatch(r"[a-z0-9.-]+", values["ACCESS_TEAM_DOMAIN"])
        is not None
        and origin.scheme == "https"
        and origin.hostname is not None
        and origin.hostname.startswith(values["WORKER_NAME"] + ".")
        and origin.username is None
        and origin.password is None
        and origin.port is None
        and origin.path in ("", "/")
        and not origin.query
        and not origin.fragment
        and values["HOST_DOMAIN"].count(".") >= 1
    )


def build_config(template, values):
    configuration = json.loads(template)
    configuration["account_id"] = values["ACCOUNT_ID"]
    configuration["name"] = values["WORKER_NAME"]
    staging = configuration["env"]["staging"]
    staging["name"] = values["WORKER_NAME"]
    staging["vars"]["APP_ORIGIN"] = (
        "https://" + values["WORKER_NAME"] + "." + values["HOST_DOMAIN"]
    )
    staging["vars"]["ACCESS_TEAM_DOMAIN"] = values["ACCESS_TEAM_DOMAIN"]
    staging["vars"]["ACCESS_AUD"] = values["ACCESS_AUD"]
    staging["d1_databases"][0]["database_name"] = values["WORKER_NAME"] + "-db"
    staging["d1_databases"][0]["database_id"] = values["DATABASE_ID"]
    staging["d1_databases"][0]["migrations_dir"] = (
        ".wrangler/e-20261006/migrations"
    )
    staging["r2_buckets"][0]["bucket_name"] = values["WORKER_NAME"] + "-media"
    return configuration


def main():
    root = Path(__file__).resolve().parent.parent
    path = root / CONFIG_NAME
    template_path = root / "docs/工程E-初期OFF設定例.jsonc"
    try:
        if path.exists() or path.is_symlink():
            raise ValueError("target_exists")
        values = discover(root)
        values["ACCESS_AUD"] = getpass.getpass("New Access AUD: ")
        if not valid(values):
            raise ValueError("invalid_input")
        template = "\n".join(
            line for line in template_path.read_text().splitlines()
            if not line.lstrip().startswith("//")
        )
        configuration = build_config(template, values)
        previous_mask = os.umask(0o077)
        try:
            descriptor = os.open(
                path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
            )
            with os.fdopen(descriptor, "w") as output:
                json.dump(configuration, output, indent=2)
                output.write("\n")
        finally:
            os.umask(previous_mask)
        metadata = path.lstat()
        if stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_uid != os.getuid():
            raise ValueError("metadata_mismatch")
        print(json.dumps({"source_prepared": True, "deploy_performed": False}))
        return 0
    except Exception as error:
        # 入力値・設定本文・例外は出さず、固定分類だけを返す。
        known = {
            "target_exists", "previous_config_invalid", "previous_origin_invalid",
            "new_database_not_unique", "new_bucket_not_found", "invalid_input",
            "metadata_mismatch",
        }
        reason = str(error) if isinstance(error, ValueError) and str(error) in known else "unavailable"
        print(json.dumps({"source_prepared": False, "deploy_performed": False, "reason": reason}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
