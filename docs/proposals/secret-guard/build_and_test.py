"""Build an uninstalled patch and test it against the current guard baseline."""
import difflib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run():
    proposal = Path(__file__).parent
    installed = Path.home() / ".agents/security/protect_sensitive.py"
    observed = installed.read_text()
    original = observed
    helper = (proposal / "literal_search.py").read_text()
    function = helper[helper.index("def literal_search("):]
    anchor = "def shell_reason(command, cwd):\n"
    check_anchor = "    # Detect common environment-dumping forms, including inside shell wrappers.\n"
    call = "    if literal_search(command, cwd, protected_path):\n        return None\n"
    if call in original:
        if original.count(call) != 1 or original.count(function + "\n\n" + anchor) != 1:
            raise RuntimeError("installed_patch_requires_review")
        original = original.replace(call, "").replace(function + "\n\n" + anchor, anchor)
    if original.count(anchor) != 1 or original.count(check_anchor) != 1:
        raise RuntimeError("baseline_requires_review")
    candidate = original.replace(anchor, function + "\n\n" + anchor)
    candidate = candidate.replace(check_anchor,
        call + check_anchor)
    patch = "".join(difflib.unified_diff(original.splitlines(keepends=True), candidate.splitlines(keepends=True),
        fromfile="a/protect_sensitive.py", tofile="b/protect_sensitive.py", n=0))
    (proposal / "literal-search.patch").write_text(patch)
    counts = {}
    with tempfile.TemporaryDirectory(prefix="guard-candidate-") as directory:
        candidate_path = Path(directory) / "protect_sensitive.py"
        candidate_path.write_text(candidate)
        baseline_path = Path(directory) / "baseline_guard.py"
        baseline_path.write_text(original)
        new_tests = load("literal_search_tests", proposal / "test_literal_search.py")
        new_tests.run(load("original_for_comparison", baseline_path), load("candidate_for_comparison", candidate_path))
        for label, script in [("baseline", baseline_path), ("candidate", candidate_path)]:
            suite_module = load("guard_tests_" + label, installed.with_name("test_protect_sensitive.py"))
            suite_module.guard = load("guard_" + label, script)
            suite_module.SCRIPT = script
            result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromModule(suite_module))
            counts[label] = {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped)}
            if not result.wasSuccessful():
                print(json.dumps(counts))
                raise RuntimeError("regression_failed")
    unchanged = installed.read_text() == observed
    print(json.dumps({"baseline_regression": counts, "installed_guard_unchanged": unchanged, "patch_created": True}))
    if not unchanged:
        raise RuntimeError("installed_guard_changed_externally")


if __name__ == "__main__":
    run()
