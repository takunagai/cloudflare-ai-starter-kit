import json
import runpy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


ROOT = Path(__file__).resolve().parent.parent
HELPER = runpy.run_path(str(ROOT / "scripts/archive/e/工程E-新隔離設定準備.py"))
VALUES = {
    "ACCOUNT_ID": "a" * 32,
    "WORKER_NAME": "test-only-e-worker",
    "HOST_DOMAIN": "example.invalid",
    "ACCESS_TEAM_DOMAIN": "team.example.invalid",
    "ACCESS_AUD": "b" * 64,
    "DATABASE_ID": "00000000-0000-0000-0000-000000000000",
}


class EConfigHelperTests(unittest.TestCase):
    def test_discovers_only_the_new_isolated_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous = root / ".wrangler.standard-staging.local.jsonc"
            previous.write_text(json.dumps({
                "account_id": "a" * 32,
                "env": {"staging": {"vars": {
                    "APP_ORIGIN": "https://old-worker.example.invalid",
                    "ACCESS_TEAM_DOMAIN": "team.example.invalid",
                }}},
            }))
            previous.chmod(0o600)
            results = [
                SimpleNamespace(stdout=json.dumps([
                    {"name": "old-worker-db", "uuid": "0" * 36},
                    {"name": "ai-starter-e-20261006-test-db", "uuid": VALUES["DATABASE_ID"]},
                ])),
                SimpleNamespace(stdout="name:           ai-starter-e-20261006-test-media\n"),
            ]
            with patch("subprocess.run", side_effect=results) as command:
                discovered = HELPER["discover"](root)
            self.assertEqual(discovered["WORKER_NAME"], "ai-starter-e-20261006-test")
            self.assertEqual(discovered["HOST_DOMAIN"], "example.invalid")
            self.assertEqual(discovered["DATABASE_ID"], VALUES["DATABASE_ID"])
            self.assertEqual(command.call_count, 2)

    def test_new_target_is_off_and_keeps_old_config_separate(self):
        self.assertTrue(HELPER["valid"](VALUES))
        template = "\n".join(
            line
            for line in (ROOT / "scripts/archive/e/工程E-初期OFF設定例.jsonc")
            .read_text()
            .splitlines()
            if not line.lstrip().startswith("//")
        )
        config = HELPER["build_config"](template, VALUES)
        staging = config["env"]["staging"]
        self.assertEqual(staging["name"], VALUES["WORKER_NAME"])
        self.assertEqual(staging["vars"]["ENABLE_MEDIA_PROBE"], "false")
        self.assertEqual(staging["routes"], [])
        self.assertEqual(
            staging["d1_databases"][0]["migrations_dir"],
            ".wrangler/e-20261006/migrations",
        )
        self.assertEqual(
            staging["d1_databases"][0]["database_name"],
            "test-only-e-worker-db",
        )
        self.assertEqual(
            staging["r2_buckets"][0]["bucket_name"],
            "test-only-e-worker-media",
        )
        self.assertEqual(
            HELPER["CONFIG_NAME"], ".wrangler.e-probe-20261006.local.jsonc"
        )

    def test_wrong_shape_is_rejected_before_writing(self):
        self.assertFalse(HELPER["valid"]({**VALUES, "DATABASE_ID": "invalid"}))
        self.assertFalse(HELPER["valid"]({**VALUES, "HOST_DOMAIN": "example.invalid/path"}))


if __name__ == "__main__":
    unittest.main()
