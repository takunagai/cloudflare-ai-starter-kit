"""Synthetic classification only: never execute any sample shell command."""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(guard=None, candidate=None):
    if guard is None:
        guard = load("installed_guard", Path.home() / ".agents/security/protect_sensitive.py")
    helper = load("proposal", Path(__file__).with_name("literal_search.py"))
    passed = 0

    def check(condition):
        nonlocal passed
        if not condition:
            raise AssertionError("synthetic_classification_failed")
        passed += 1

    with tempfile.TemporaryDirectory(prefix="guard-proposal-") as directory:
        root = Path(directory)
        (root / "source.py").write_text("# Empty synthetic source\n")
        (root / "safe-link.py").symlink_to("source.py")
        (root / "blocked-link.py").symlink_to(".env")

        def original(command):
            return guard.shell_reason(command, directory)

        def proposed(command):
            if candidate is not None:
                return candidate.shell_reason(command, directory)
            if helper.literal_search(command, directory, guard.protected_path):
                return None
            return original(command)

        # Reproduce the three distinct classifications without real file reads.
        check(original("python3 - <<'PY'\ns = 'getModel(id, env)'\nPY\n") == "environment-or-debug")
        check(original("rg -n -A 45 -B 12 'environment-or-debug|ENV|printenv' source.py") == "environment-or-debug")
        check(guard.sensitive_name("src/server/env.ts"))

        for command in [
            "rg --no-config -- 'printenv' source.py",
            "rg --no-config -n -A 45 -B 12 -- 'environment-or-debug|ENV|printenv' source.py",
            "rg --no-config -- 'env' safe-link.py",
        ]:
            check(original(command) == "environment-or-debug")
            check(proposed(command) is None)

        # Option-looking patterns remain patterns because '--' is mandatory.
        check(helper.literal_search("rg --no-config -- '-f' source.py", directory, guard.protected_path))
        check(not helper.literal_search("rg --no-config '-f' source.py", directory, guard.protected_path))

        # These commands are only strings supplied to the classifier. No secret
        # file is created/read and no environment listing is performed.
        for command in [
            "env", "printenv", "bash -c 'env'", "(env)",
            "python3 - <<'PY'\nprint(os.environ)\nPY\n",
            "python3 - <<'PY'\ns = 'getModel(id, env)'\nPY\n",
            "rg --no-config 'env' .env",
            "rg --no-config 'env' env.ts",
            "rg --no-config 'env' blocked-link.py",
            "rg --no-config 'env' .",
            "rg --no-config 'env' missing.py",
            "rg --no-config 'env' source.py; env",
            "rg --no-config 'env' source.py > output.txt",
            "rg --no-config 'env' source.py | bash",
            "rg --no-config 'env' source.py\nenv",
            "rg --no-config \"$(env)\" source.py",
            "rg --no-config '`env`' source.py",
            "rg --no-config 'env' $(pwd)/source.py",
            "rg --no-config 'env' *.py",
            "rg --no-config -e 'env' source.py",
            "rg --no-config -f source.py 'env' source.py",
            "rg --no-config --pre bash 'env' source.py",
            "rg --no-config --hidden 'env' source.py",
            "rg --no-config 'env' source.py source.py",
            "rg --no-config 'env' --pre=bash",
            "rg --no-config 'env' source.py # comment",
            "rg --no-config 'env' source.py\\\n",
            "rg --no-config 'env' source.py ",
            "rg 'env' source.py",
            "rg --no-config -- 'env' .env",
            "rg --no-config -- 'env' env.ts",
            "rg --no-config -- 'env' blocked-link.py",
            "rg --no-config -- 'env' .",
            "rg --no-config -- 'env' missing.py",
            "rg --no-config -- 'env' source.py; env",
            "rg --no-config -- 'env' source.py > output.txt",
            "rg --no-config -- 'env' source.py | bash",
            "rg --no-config -- 'env' source.py\nenv",
            "rg --no-config -- \"$(env)\" source.py",
            "rg --no-config -- '`env`' source.py",
            "rg --no-config -- 'env' $(pwd)/source.py",
            "rg --no-config -- 'env' *.py",
            "rg --no-config --pre bash -- 'env' source.py",
            "rg --no-config --hidden -- 'env' source.py",
            "rg --no-config -- 'env' source.py source.py",
            "rg --no-config -- 'env' --pre=bash",
            "rg --no-config -- 'env' source.py # comment",
            "rg --no-config -- 'env' source.py\\\n",
        ]:
            check(not helper.literal_search(command, directory, guard.protected_path))
            check(proposed(command) == original(command))

        for command in ["env", "printenv", "bash -c 'env'", "cat .env"]:
            check(proposed(command) is not None)

        for command in ["cat source.py", "pnpm test", "git status --short"]:
            check(proposed(command) == original(command))

    print(json.dumps({"synthetic_checks": passed, "failed": 0, "sample_commands_executed": 0, "installed_guard_modified": False}))


if __name__ == "__main__":
    load("proposal_runner", Path(__file__).with_name("build_and_test.py")).run()
