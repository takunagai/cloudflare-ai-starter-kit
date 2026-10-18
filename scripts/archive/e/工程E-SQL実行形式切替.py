"""本人の別ターミナルで、今回専用のSQL実行形式だけを切り替える。"""

import json
import os
import stat
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    path = root / ".wrangler.standard-staging.local.jsonc"
    directory = root / ".wrangler/e-live/migrations"
    try:
        metadata = path.lstat()
        if (
            stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or len(list(directory.glob("*.sql"))) != 11
        ):
            raise ValueError("metadata_mismatch")
        configuration = json.loads(path.read_text())
        staging = configuration["env"]["staging"]
        if (
            staging["vars"]["APP_ENV"] != "staging"
            or staging["vars"]["STAGING_POLICY"] != "standard"
            or len(staging["d1_databases"]) != 1
            or staging["d1_databases"][0]["binding"] != "DB"
        ):
            raise ValueError("target_shape_mismatch")
        current = staging["d1_databases"][0]["migrations_dir"]
        if current not in ["migrations", ".wrangler/e-live/migrations"]:
            raise ValueError("unexpected_migration_directory")
        if current == "migrations":
            staging["d1_databases"][0]["migrations_dir"] = ".wrangler/e-live/migrations"
            path.write_text(json.dumps(configuration, indent=2) + "\n")
        print(json.dumps({"migration_transport_ready": True}))
        return 0
    except Exception:
        # 設定値や入力抜粋を表示しない。
        print(json.dumps({"migration_transport_ready": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
