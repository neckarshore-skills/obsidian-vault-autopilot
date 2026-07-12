#!/usr/bin/env python3
"""Vault property + tag + folder scanner for obsidian-bases-generator.

Builds the coverage index that grounds every dashboard proposal. A dashboard
built on a property only three notes use is noise, not signal — so scan first,
propose second, write third.

Reads the vault (read-only; never writes a note), parses YAML frontmatter, and
reports three things a Base filter can actually reference:

  1. Property coverage  — which frontmatter keys exist, on how many notes, with
     which top values. Coverage (% of notes carrying the key) is the deciding
     metric for whether a property is worth a dashboard.
  2. Tag inventory      — frontmatter `tags` plus inline `#tags`, because Bases
     filters use file.hasTag("X"); a category formula may only reference a tag
     the scan actually found.
  3. Folder inventory    — top-level folders and note counts, because
     file.inFolder("...") needs the real folder name, verbatim.

House scan rules (references/vault-autopilot-note.md, config-spec.md):
folders whose name starts with an excluded prefix (default "_" and ".") are
skipped wholesale — this covers _vault-autopilot/, _trash/, _secret/,
.obsidian/, .trash/. Pass --exclude-prefix to override.

Usage:
    python scan_properties.py [VAULT_PATH] [--json OUT.json] [--exclude-prefix _ .]
    VAULT_PATH defaults to $OBSIDIAN_VAULT_PATH.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---", re.DOTALL)
# Inline tags: #Word or #Nested/Tag. Excludes bare '#' and markdown headings
# (a heading is '# ' with a space; a tag has no space after #).
INLINE_TAG_RE = re.compile(r"(?:^|\s)#([A-Za-z][\w/-]*)")


def is_excluded_dir(name, prefixes):
    return any(name.startswith(p) for p in prefixes)


def normalize_tags(raw):
    """Frontmatter tags may be a list, a comma/space string, or a single scalar."""
    out = []
    if raw is None:
        return out
    if isinstance(raw, str):
        parts = re.split(r"[,\s]+", raw.strip())
        out = [p.lstrip("#") for p in parts if p]
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip().lstrip("#"))
    return out


def scan(vault, prefixes):
    total_notes = 0
    notes_with_frontmatter = 0
    prop_count = Counter()
    prop_values = defaultdict(Counter)
    tag_count = Counter()
    folder_notes = Counter()
    parse_failures = []  # notes whose frontmatter is present but unparseable

    for root, dirs, files in os.walk(vault):
        # Prune excluded dirs in-place so os.walk does not descend into them.
        dirs[:] = [d for d in dirs if not is_excluded_dir(d, prefixes)]
        rel_root = os.path.relpath(root, vault)
        top = "(root)" if rel_root == "." else rel_root.split(os.sep)[0]

        for fn in files:
            if not fn.endswith(".md"):
                continue
            # Protected notes (e.g. _vault-autopilot.md) share the excluded-dir
            # prefix convention; os.walk only prunes DIRS, so skip files by name
            # too or a protected marker note inflates the coverage counts.
            if is_excluded_dir(fn, prefixes):
                continue
            total_notes += 1
            folder_notes[top] += 1
            path = os.path.join(root, fn)
            rel_path = os.path.relpath(path, vault)
            try:
                text = open(path, encoding="utf-8").read()
            except Exception:
                continue

            # Inline tags from the whole note body.
            for t in INLINE_TAG_RE.findall(text):
                tag_count[t] += 1

            m = FRONTMATTER_RE.match(text)
            if not m:
                continue
            try:
                fm = yaml.safe_load(m.group(1)) or {}
            except Exception:
                parse_failures.append(rel_path)
                continue
            if not isinstance(fm, dict):
                continue
            notes_with_frontmatter += 1

            for k, v in fm.items():
                prop_count[k] += 1
                if k == "tags":
                    for t in normalize_tags(v):
                        tag_count[t] += 1
                elif isinstance(v, (str, int, float, bool)):
                    prop_values[k][str(v)] += 1
                elif isinstance(v, list):
                    prop_values[k]["(list)"] += 1
                elif v is None:
                    prop_values[k]["(empty)"] += 1

    return {
        "vault": vault,
        "total_notes": total_notes,
        "notes_with_frontmatter": notes_with_frontmatter,
        "prop_count": prop_count,
        "prop_values": prop_values,
        "tag_count": tag_count,
        "folder_notes": folder_notes,
        "parse_failures": parse_failures,
    }


def pct(n, total):
    return f"{round(100 * n / total)}%" if total else "0%"


def print_report(r):
    total = r["total_notes"]
    print(f"\nVault: {r['vault']}")
    print(f"Total notes scanned: {total}  "
          f"(with frontmatter: {r['notes_with_frontmatter']})")
    if r["parse_failures"]:
        print(f"Unparseable frontmatter: {len(r['parse_failures'])} "
              f"(→ Class-C finding candidates)")

    print("\n== Property coverage (>=1 note), sorted by coverage ==")
    print(f"{'Property':<24}{'Notes':>7}{'Cov':>7}  Top values")
    for k, c in r["prop_count"].most_common():
        top = r["prop_values"].get(k)
        if k == "tags":
            top_str = "(see tag inventory)"
        elif top:
            top_str = ", ".join(f"{val} ({n})" for val, n in top.most_common(5))
        else:
            top_str = "(non-scalar)"
        flag = "  <WEAK <20%" if total and c / total < 0.20 else ""
        print(f"{k:<24}{c:>7}{pct(c, total):>7}  {top_str[:70]}{flag}")

    print("\n== Tag inventory (frontmatter + inline), top 30 ==")
    for t, c in r["tag_count"].most_common(30):
        print(f"  {t:<32}{c:>6}")

    print("\n== Folder inventory (top-level, note counts) ==")
    for f, c in sorted(r["folder_notes"].items(), key=lambda kv: -kv[1]):
        print(f"  {f:<60}{c:>6}")
    print()


def to_jsonable(r):
    return {
        "vault": r["vault"],
        "total_notes": r["total_notes"],
        "notes_with_frontmatter": r["notes_with_frontmatter"],
        "properties": {
            k: {
                "count": c,
                "coverage_pct": round(100 * c / r["total_notes"]) if r["total_notes"] else 0,
                "top_values": dict(r["prop_values"].get(k, Counter()).most_common(10)),
            }
            for k, c in r["prop_count"].most_common()
        },
        "tags": dict(r["tag_count"].most_common(50)),
        "folders": dict(sorted(r["folder_notes"].items(), key=lambda kv: -kv[1])),
        "parse_failures": r["parse_failures"],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("vault", nargs="?", default=os.environ.get("OBSIDIAN_VAULT_PATH"))
    ap.add_argument("--json", dest="json_out")
    ap.add_argument("--exclude-prefix", nargs="+", default=["_", "."])
    args = ap.parse_args()

    if not args.vault:
        sys.exit("No vault path. Pass VAULT_PATH or set OBSIDIAN_VAULT_PATH.")
    if not os.path.isdir(args.vault):
        sys.exit(f"Vault not found: {args.vault}")

    r = scan(args.vault, args.exclude_prefix)
    print_report(r)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(to_jsonable(r), fh, indent=2, ensure_ascii=False)
        print(f"JSON written: {args.json_out}")


if __name__ == "__main__":
    main()
