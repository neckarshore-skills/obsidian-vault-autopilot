#!/usr/bin/env python3
"""Validate one or more .base files before they reach Obsidian.

A silently broken base renders as a red YAML error in Obsidian and helps no
one — so we validate before writing, never after. This checks the two failure
classes a generator actually produces:

  1. The file is not valid YAML.
  2. A view references formula.X somewhere, but X is not defined under
     `formulas:`. Obsidian fails this silently (the column just never renders),
     which is worse than a loud error — you think the base works.

Formula references can hide in FOUR places, not just `order`. Checking only
`order` (the naive version) lets a typo'd groupBy or a stale properties key
sail through validation and break in Obsidian:

  - view.order[]                     (columns shown)
  - view.groupBy.property            (grouping key — often a formula)
  - view.summaries{} keys            (per-column summary rows)
  - top-level properties{} keys      (display-name overrides)

What this does NOT check: the Bases expression language itself (operator
validity, .days-before-.round, null-guards). Those are format rules verified
against references/bases-syntax.md by the author, not machine-checkable here —
see the checklist the skill runs after this script passes.

Usage:
    python validate_base.py FILE.base [FILE2.base ...]
Exit code 0 = all valid, 1 = at least one failure.
"""

import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")


def formula_refs_in(value):
    """Yield every 'formula.X' name reachable inside a value (str/list/dict)."""
    if isinstance(value, str):
        if value.startswith("formula."):
            yield value.split(".", 1)[1]
    elif isinstance(value, list):
        for item in value:
            yield from formula_refs_in(item)
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from formula_refs_in(k)
            yield from formula_refs_in(v)


def validate_base(path):
    try:
        text = open(path, encoding="utf-8").read()
    except Exception as e:
        return False, f"cannot read file: {e}"
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        return False, f"YAML error: {e}"
    if not isinstance(data, dict):
        return False, "top level is not a YAML mapping"

    defined = set((data.get("formulas") or {}).keys())

    # Top-level properties{} keys may be 'formula.X' display-name overrides.
    for key in (data.get("properties") or {}):
        if isinstance(key, str) and key.startswith("formula."):
            name = key.split(".", 1)[1]
            if name not in defined:
                return False, f"properties references undefined formula: {key}"

    for i, view in enumerate(data.get("views") or []):
        where = f"view[{i}] ({view.get('name', 'unnamed')})"
        # order[] columns
        for name in formula_refs_in(view.get("order")):
            if name not in defined:
                return False, f"{where} order references undefined formula.{name}"
        # groupBy.property
        gb = (view.get("groupBy") or {}).get("property")
        if isinstance(gb, str) and gb.startswith("formula."):
            name = gb.split(".", 1)[1]
            if name not in defined:
                return False, f"{where} groupBy references undefined formula.{name}"
        # summaries{} keys
        for key in (view.get("summaries") or {}):
            if isinstance(key, str) and key.startswith("formula."):
                name = key.split(".", 1)[1]
                if name not in defined:
                    return False, f"{where} summaries references undefined formula.{name}"

    return True, "OK"


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python validate_base.py FILE.base [FILE2.base ...]")
    all_ok = True
    for path in sys.argv[1:]:
        ok, msg = validate_base(path)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {path} — {msg}")
        all_ok = all_ok and ok
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
