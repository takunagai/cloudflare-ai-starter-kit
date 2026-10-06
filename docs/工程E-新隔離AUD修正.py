"""本人が新AccessアプリのAUDだけを管理外設定へ反映・照合する。"""

import argparse
import getpass
import json
import os
import re
import stat
import sys
import warnings
from pathlib import Path


def read_private(path):
    metadata = path.lstat()
    if (
        stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise ValueError("metadata_mismatch")
    return json.loads(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("update", "verify-generated"))
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    path = root / ".wrangler.e-probe-20261006.local.jsonc"
    try:
        source = read_private(path)
        staging = source["env"]["staging"]
        variables = staging["vars"]
        if (
            variables["APP_ENV"] != "staging"
            or variables["STAGING_POLICY"] != "standard"
            or variables["AUTH_MODE"] != "access"
            or variables["ENABLE_MEDIA_PROBE"] != "true"
            or not re.fullmatch(r"ai-starter-e-20261006-[a-z0-9]+", staging["name"])
        ):
            raise ValueError("target_mismatch")
        if not sys.stdin.isatty() or not sys.stderr.isatty():
            raise ValueError("interactive_terminal_required")
        warnings.simplefilter("error", getpass.GetPassWarning)
        audience = getpass.getpass("新AccessアプリのAUDを非表示で入力: ")
        if re.fullmatch(r"[0-9a-f]{64}", audience) is None:
            raise ValueError("aud_format_invalid")
        if arguments.mode == "update":
            if variables["ACCESS_AUD"] == audience:
                raise ValueError("aud_unchanged")
            variables["ACCESS_AUD"] = audience
            path.write_text(json.dumps(source, indent=2) + "\n")
            print(json.dumps({"source_prepared": True, "deploy_performed": False}))
            return 0
        generated = json.loads((root / "dist/server/wrangler.json").read_text())
        checks = {
            "source_matches": variables["ACCESS_AUD"] == audience,
            "generated_matches": generated.get("vars", {}).get("ACCESS_AUD") == audience,
            "same_worker": generated.get("name") == staging["name"],
        }
        passed = all(checks.values())
        print(json.dumps({"checks": checks, "all_passed": passed}))
        return 0 if passed else 1
    except Exception:
        print(json.dumps({"source_prepared": False, "all_passed": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
