#!/usr/bin/env python3
"""Validate one or more .base files before they reach Obsidian.

A silently broken base renders as a red YAML error in Obsidian and helps no
one — so we validate before writing, never after. This checks the two failure
classes a generator actually produces:

  1. The file is not valid YAML.
  2. A view references formula.X somewhere, but X is not defined under
     `formulas:`. Obsidian fails this silently (the column just never renders),
     which is worse than a loud error — you think the base works.

Formula references can hide in many places, not just `order`. Checking only
`order` (the naive version) lets a typo'd groupBy or a stale properties key
sail through validation and break in Obsidian:

  - view.order[]                     (columns shown)
  - view.groupBy.property            (grouping key — often a formula)
  - view.sort[].property             (row ordering — often a formula)
  - view.summaries{} keys            (per-column summary rows)
  - view.filters + top-level filters (expressions like `formula.hot > 5`)
  - top-level properties{} keys      (display-name overrides)

Filters and sort hold expression STRINGS, so references are extracted with a
regex (see FORMULA_REF_RE), not a startswith check. Every container is also
shape-guarded: a malformed .base returns a clean FAIL instead of crashing.

What this does NOT check: the Bases expression language itself (operator
validity, .days-before-.round, null-guards). Those are format rules verified
against references/bases-syntax.md by the author, not machine-checkable here —
see the checklist the skill runs after this script passes.

Usage:
    python validate_base.py FILE.base [FILE2.base ...]
Exit code 0 = all valid, 1 = at least one failure.
"""

import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

# A formula reference is the token `formula.<name>` wherever it appears — a bare
# order entry ("formula.age_days"), a groupBy property, OR embedded inside a
# filter/sort expression string ("formula.age_days > 5 && formula.hot").
# A naive startswith+split only handles the bare case and mangles expressions
# (it would yield "age_days > 5" as a name), so extract the token with a regex.
FORMULA_REF_RE = re.compile(r"formula\.([A-Za-z_]\w*)")


def formula_refs_in(value):
    """Yield every 'formula.X' name reachable inside a value (str/list/dict)."""
    if isinstance(value, str):
        yield from FORMULA_REF_RE.findall(value)
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

    # Shape-guard every container before we walk it. A malformed .base (e.g.
    # `formulas: "oops"`) must return a clean FAIL, never crash with
    # AttributeError — a validator that dies on bad input defeats its own point.
    formulas = data.get("formulas") or {}
    if not isinstance(formulas, dict):
        return False, "'formulas' is not a YAML mapping"
    defined = set(formulas.keys())

    properties = data.get("properties") or {}
    if not isinstance(properties, dict):
        return False, "'properties' is not a YAML mapping"
    # Top-level properties{} keys may be 'formula.X' display-name overrides.
    for name in formula_refs_in(list(properties.keys())):
        if name not in defined:
            return False, f"properties references undefined formula.{name}"

    # Top-level filters apply to every view and may reference formula.X.
    for name in formula_refs_in(data.get("filters")):
        if name not in defined:
            return False, f"top-level filters references undefined formula.{name}"

    views = data.get("views") or []
    if not isinstance(views, list):
        return False, "'views' is not a YAML list"
    for i, view in enumerate(views):
        if not isinstance(view, dict):
            return False, f"view[{i}] is not a YAML mapping"
        where = f"view[{i}] ({view.get('name', 'unnamed')})"
        # order[] (columns), view-specific filters, and sort[] all take formula.X
        for kind in ("order", "filters", "sort"):
            for name in formula_refs_in(view.get(kind)):
                if name not in defined:
                    return False, f"{where} {kind} references undefined formula.{name}"
        # groupBy.property
        groupby = view.get("groupBy") or {}
        if not isinstance(groupby, dict):
            return False, f"{where} groupBy is not a YAML mapping"
        for name in formula_refs_in(groupby.get("property")):
            if name not in defined:
                return False, f"{where} groupBy references undefined formula.{name}"
        # summaries{} keys
        summaries = view.get("summaries") or {}
        if not isinstance(summaries, dict):
            return False, f"{where} summaries is not a YAML mapping"
        for name in formula_refs_in(list(summaries.keys())):
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
