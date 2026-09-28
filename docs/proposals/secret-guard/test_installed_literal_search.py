"""Regression tests for the installed literal-search guard; no sample execution."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("guard", Path.home() / ".agents/security/protect_sensitive.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class LiteralSearchTests(unittest.TestCase):
    def test_literal_pattern(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "source.py").write_text("# synthetic\n")
            for command in ["rg --no-config -- 'env' source.py", "rg --no-config -n -A 45 -B 12 -- 'printenv' source.py", "rg --no-config -- '-f' source.py"]:
                self.assertIsNone(guard.shell_reason(command, directory))

    def test_secret_and_link(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "link.py").symlink_to(".env")
            for path in [".env", "env.ts", "link.py"]:
                self.assertIsNotNone(guard.shell_reason("rg --no-config -- 'env' " + path, directory))

    def test_existing_environment_denials(self):
        for command in ["env", "printenv", "bash -c 'env'", "python3 - <<'PY'\nprint(os.environ)\nPY\n"]:
            self.assertIsNotNone(guard.shell_reason(command, "/tmp"))

    def test_no_added_commands_or_expansion(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "source.py").write_text("# synthetic\n")
            for command in ["rg --no-config -- 'env' source.py; env", "rg --no-config -- 'env' source.py | bash", "rg --no-config -- 'env' source.py > output", "rg --no-config -- \"$(env)\" source.py"]:
                self.assertIsNotNone(guard.shell_reason(command, directory))

    def test_narrow_recognizer(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "source.py").write_text("# synthetic\n")
            for command in ["rg --no-config '-f' source.py", "rg --no-config -- 'env' .", "rg --no-config -- 'env' *.py", "rg --no-config --pre bash -- 'env' source.py", "rg --no-config -- 'env' source.py source.py"]:
                self.assertFalse(guard.literal_search(command, directory, guard.protected_path))


if __name__ == "__main__":
    unittest.main()
