"""本人が新隔離設定のmigration実行先だけを切り替える。"""

import json
import os
import stat
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[3]
    path = root / ".wrangler.e-probe-20261006.local.jsonc"
    directory = root / ".wrangler/e-20261006/migrations"
    target = ".wrangler/e-20261006/migrations"
    try:
        metadata = path.lstat()
        names = sorted(item.name for item in directory.glob("*.sql"))
        if (
            stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or len(names) != 12
            or any(int(name[:4]) != index + 1 for index, name in enumerate(names))
        ):
            raise ValueError("metadata_mismatch")
        configuration = json.loads(path.read_text())
        staging = configuration["env"]["staging"]
        database = staging["d1_databases"][0]
        if (
            staging["vars"]["APP_ENV"] != "staging"
            or staging["vars"]["STAGING_POLICY"] != "standard"
            or len(staging["d1_databases"]) != 1
            or database["binding"] != "DB"
            or database["migrations_dir"] not in ("migrations", target)
        ):
            raise ValueError("target_shape_mismatch")
        if database["migrations_dir"] != target:
            database["migrations_dir"] = target
            path.write_text(json.dumps(configuration, indent=2) + "\n")
        print(json.dumps({"migration_transport_ready": True}))
        return 0
    except Exception:
        print(json.dumps({"migration_transport_ready": False}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
