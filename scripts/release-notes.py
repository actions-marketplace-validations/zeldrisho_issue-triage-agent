#!/usr/bin/env python3
"""Validate a stable release tag and print its changelog section."""

import datetime
import json
import re
import sys
from pathlib import Path


def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", sys.argv[1]):
        raise ValueError("Expected a stable release tag in the form vX.Y.Z")

    version = sys.argv[1][1:]
    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    if package.get("version") != version:
        raise ValueError(f"Tag version {version} does not match package.json")

    changelog = Path("CHANGELOG.md").read_text(encoding="utf-8")
    pattern = rf"^## \[{re.escape(version)}\] - (\d{{4}}-\d{{2}}-\d{{2}})\s*$"
    matches = list(re.finditer(pattern, changelog, re.MULTILINE))
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one dated changelog section for {version}")
    datetime.date.fromisoformat(matches[0].group(1))
    start = matches[0].end()
    next_section = re.search(r"^## \[", changelog[start:], re.MULTILINE)
    notes = changelog[start : start + next_section.start() if next_section else None].strip()
    # Reference definitions at the end of the file are not release notes.
    notes = re.sub(r"(?m)^\[[^\]]+\]:\s+\S+.*$", "", notes).strip()
    if not notes or not re.search(r"(?m)^-\s+\S", notes):
        raise ValueError(f"Changelog section for {version} has no release entries")
    print(notes)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Release validation failed: {error}", file=sys.stderr)
        sys.exit(1)
