import runpy
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HELPER = runpy.run_path(str(ROOT / "docs/工程E-新隔離fal終了操作.py"))
VALIDATE = HELPER["validate_target"]
FINISH_OVERRIDE_MATCHES = HELPER["finish_override_matches"]
NOW = datetime(2026, 10, 6, 1, 30, tzinfo=timezone.utc).timestamp()
TARGET = {
    "request_id": "00000000-0000-4000-8000-000000000001",
    "model": "openai/gpt-image-2.5/sunburst/text-to-image",
    "billing_since_utc": "2026-10-06T01:00:00Z",
    "delete_not_before_epoch": int(NOW) - 60,
    "delete_mode": "early_failure",
    "failure_evidence_recorded": True,
    "natural_expiry_verified": False,
    "expiry_observation_unknown": False,
}


class EFinishHelperTests(unittest.TestCase):
    def test_private_target_is_created_once_without_printing_values(self):
        current = datetime.now(timezone.utc)
        target = {
            **TARGET,
            "billing_since_utc": (current - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "delete_not_before_epoch": int(current.timestamp()) - 60,
        }
        with tempfile.TemporaryDirectory() as directory:
            output = StringIO()
            with redirect_stdout(output):
                self.assertEqual(HELPER["prepare_target"](Path(directory), target), 0)
            path = Path(directory) / "終了対象.json"
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(target["request_id"], output.getvalue())
            with self.assertRaises(FileExistsError):
                HELPER["prepare_target"](Path(directory), target)

    def test_early_failure_requires_recorded_evidence(self):
        self.assertEqual(VALIDATE(TARGET, NOW), TARGET["request_id"])
        with self.assertRaises(ValueError):
            VALIDATE({**TARGET, "failure_evidence_recorded": False}, NOW)

    def test_natural_expiry_requires_verified_evidence(self):
        target = {
            **TARGET,
            "delete_mode": "after_natural_expiry",
            "failure_evidence_recorded": False,
            "natural_expiry_verified": True,
        }
        self.assertEqual(VALIDATE(target, NOW), TARGET["request_id"])
        with self.assertRaises(ValueError):
            VALIDATE({**target, "natural_expiry_verified": False}, NOW)

    def test_unknown_observation_is_distinct_from_verified_expiry(self):
        target = {
            **TARGET,
            "delete_mode": "after_observation_unknown",
            "failure_evidence_recorded": False,
            "natural_expiry_verified": False,
            "expiry_observation_unknown": True,
        }
        self.assertEqual(VALIDATE(target, NOW), TARGET["request_id"])
        self.assertFalse(FINISH_OVERRIDE_MATCHES(target, False))
        self.assertTrue(FINISH_OVERRIDE_MATCHES(target, True))
        for patch in (
            {"expiry_observation_unknown": False},
            {"natural_expiry_verified": True},
            {"failure_evidence_recorded": True},
        ):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                VALIDATE({**target, **patch}, NOW)

        self.assertTrue(FINISH_OVERRIDE_MATCHES(TARGET, False))
        self.assertFalse(FINISH_OVERRIDE_MATCHES(TARGET, True))

    def test_wrong_target_or_time_is_rejected(self):
        for patch in (
            {"request_id": "invalid"},
            {"model": "another-model"},
            {"delete_not_before_epoch": 0},
            {"billing_since_utc": "2026-10-07T01:00:00Z"},
        ):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                VALIDATE({**TARGET, **patch}, NOW)


if __name__ == "__main__":
    unittest.main()
