"""Uninstalled proposal: recognize one non-executing, literal search form.

This helper must only be called by shell_reason before its broad text checks.
It is deliberately not a general shell parser or an authorization to read files.
"""
import re
from pathlib import Path


def literal_search(command, cwd, protected_path):
    # Single quotes keep the pattern literal. Explicit --no-config prevents an
    # external ripgrep configuration from enabling preprocessing or extra paths.
    # No wrappers, redirection, shell substitutions, globbing, or option files.
    match = re.fullmatch(
        r"rg --no-config(?: -n)?(?: -A [0-9]{1,3})?(?: -B [0-9]{1,3})? -- "
        r"'[^'\r\n$`\\]*' ([A-Za-z0-9_./~-]+)",
        command,
    )
    if not match:
        return False
    target = match[1]
    if target.startswith("-") or protected_path(target, cwd):
        return False
    path = Path(target).expanduser()
    if not path.is_absolute():
        path = Path(cwd) / path
    try:
        return path.is_file()
    except (OSError, ValueError):
        return False
