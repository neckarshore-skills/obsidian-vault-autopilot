#!/usr/bin/env python3
"""
Validate recipe (g) — Canonical property order (block-aware reorder).

This is the deterministic part of the canonical-property-order feature that does
NOT depend on an LLM. It applies the recipe-g algorithm directly to fixtures and
compares the result against expected golden files, then re-applies to the golden
to prove idempotency. Validates that fixtures + recipe are internally consistent.

Recipe-g reorders YAML frontmatter properties into a canonical order while moving
each property as an atomic UNIT (its key line plus any indented list items /
folded-scalar body). Block reorder is the F8/F15/F26 data-loss class — the golden
fixtures, not the spec prose, are the proof.

Algorithm (per references/yaml-edits.md recipe (g)):
  1. Split frontmatter (recipe a semantics: first `---` at col 0 .. next `---` at col 0).
     Preserve BOM, CRLF vs LF, and trailing-newline presence.
  2. Walk frontmatter lines, grouping into property BLOCKS:
       block = leading comment trivia + key line + indented/folded continuation.
     - A top-level key line has no leading whitespace and is not a comment.
     - Continuation = the run of following indented-or-blank lines, with trailing
       blank lines trimmed off (blanks INSIDE a block scalar — i.e. followed by a
       further indented line — stay; trailing blanks before the next key leave).
     - Blank lines between top-level keys are non-semantic -> dropped.
     - Comment lines (`#...`) are semantic -> preserved as leading trivia of the
       following block (move with it). A trailing comment with no following block
       is kept at the end of the frontmatter.
  3. Stable-sort blocks: lead block (CANONICAL order) -> middle (custom keys, original
     relative order) -> `tags` always last.
  4. Idempotent: re-running on the reordered output is a zero-diff no-op.

Does NOT dedupe duplicate keys (that is recipe-f's job). Does NOT repair broken
keys. Reorder only.

Exit 0 on PASS, 1 on diff, 2 on error.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CASES_DIR = REPO_ROOT / "tests" / "fixtures" / "recipe-g-property-order" / "cases"

# Canonical lead block (logical-lead exception). `tags` is the symmetric trailer.
CANONICAL = [
    "title",
    "description",
    "type",
    "status",
    "created",
    "modified",
    "aliases",
    "source",
    "parent",
    "priority",
]
TAGS_KEY = "tags"

BOM = "﻿"
_QUOTED_KEY_RE = re.compile(r'\s*"([^"]*)"\s*:')


def _is_comment(line: str) -> bool:
    return line.lstrip().startswith("#")


def _is_blank(line: str) -> bool:
    return line.strip() == ""


def _is_indented(line: str) -> bool:
    return line[:1] in (" ", "\t")


def _is_key_line(line: str) -> bool:
    """A top-level frontmatter key line: column-0, not blank, not comment, has a colon."""
    if not line or _is_indented(line):
        return False
    if _is_comment(line):
        return False
    return ":" in line


def _key_name(line: str) -> str:
    """Extract the (unquoted) key name from a key line, lowercased for ranking."""
    m = _QUOTED_KEY_RE.match(line)
    if m:
        return m.group(1).strip().lower()
    return line.split(":", 1)[0].strip().lower()


def _rank(block: dict) -> tuple:
    name = block["name"]
    if name in CANONICAL:
        return (0, CANONICAL.index(name), 0)
    if name == TAGS_KEY:
        return (2, 0, 0)
    return (1, 0, block["orig"])  # middle: preserve original relative order


def _detect_newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def reorder(text: str) -> str:
    """Reorder YAML frontmatter into canonical property order. No-op if no frontmatter."""
    had_bom = text.startswith(BOM)
    work = text[len(BOM):] if had_bom else text
    newline = _detect_newline(work)
    had_trailing_newline = work.endswith(("\n", "\r"))

    lines = work.splitlines()
    if not lines or lines[0].rstrip() != "---":
        return text  # no frontmatter -> untouched

    close = None
    for i in range(1, len(lines)):
        # closing fence = `---` at column 0 (a `---` inside a scalar would be indented)
        if not _is_indented(lines[i]) and lines[i].rstrip() == "---":
            close = i
            break
    if close is None:
        return text  # unclosed frontmatter -> untouched (recipe-a / yaml-sanity handles it)

    fm = lines[1:close]
    body = lines[close + 1:]

    blocks: list[dict] = []
    pending: list[str] = []  # accumulated trivia (blank/comment) awaiting the next key
    orig = 0
    i = 0
    n = len(fm)
    while i < n:
        line = fm[i]
        if _is_key_line(line):
            leading = [t for t in pending if _is_comment(t)]  # drop blanks, keep comments
            pending = []
            # consume continuation run: following indented-or-blank lines
            j = i + 1
            cont = []
            while j < n and (_is_blank(fm[j]) or _is_indented(fm[j])):
                cont.append(fm[j])
                j += 1
            # keep up to the last indented (non-blank) line; trailing blanks spill out (dropped)
            last_indented = -1
            for k, c in enumerate(cont):
                if _is_indented(c) and not _is_blank(c):
                    last_indented = k
            keep = cont[: last_indented + 1]
            # spill (cont[last_indented+1:]) are pure blanks -> dropped, nothing to carry
            blocks.append(
                {"name": _key_name(line), "orig": orig, "lines": leading + [line] + keep}
            )
            orig += 1
            i = j
        elif _is_blank(line) or _is_comment(line):
            pending.append(line)
            i += 1
        else:
            # malformed: an indented/continuation line with no owning key, or stray content.
            # Attach to the previous block if any (do no harm: never drop data); else to pending.
            if blocks:
                blocks[-1]["lines"].append(line)
            else:
                pending.append(line)
            i += 1

    trailing = [t for t in pending if _is_comment(t)]  # keep trailing comments, drop blanks

    ordered = sorted(blocks, key=_rank)
    out_fm: list[str] = []
    for b in ordered:
        out_fm.extend(b["lines"])
    out_fm.extend(trailing)

    result_lines = ["---"] + out_fm + ["---"] + body
    out = newline.join(result_lines)
    if had_trailing_newline:
        out += newline
    if had_bom:
        out = BOM + out
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Self-test: in-memory invariants (CRLF / BOM / no-frontmatter / trailing newline)
# ─────────────────────────────────────────────────────────────────────────────
def _selftest() -> list[str]:
    failures = []

    def check(name, cond):
        if not cond:
            failures.append(name)

    # No frontmatter -> untouched.
    plain = "# Just a note\n\nSome text.\n"
    check("no-frontmatter-untouched", reorder(plain) == plain)

    # Unclosed frontmatter -> untouched.
    unclosed = "---\ntitle: X\nno closing fence\n"
    check("unclosed-frontmatter-untouched", reorder(unclosed) == unclosed)

    # CRLF preserved.
    crlf = "---\r\ncreated: 2024-01-01\r\ntitle: X\r\n---\r\nbody\r\n"
    out_crlf = reorder(crlf)
    check("crlf-preserved", "\r\n" in out_crlf and "\n" not in out_crlf.replace("\r\n", ""))
    check("crlf-reordered-title-first", out_crlf.split("\r\n")[1].startswith("title:"))

    # BOM preserved + still reorders.
    bom = BOM + "---\ncreated: 2024-01-01\ntitle: X\n---\nbody\n"
    out_bom = reorder(bom)
    check("bom-preserved", out_bom.startswith(BOM))
    check("bom-reordered-title-first", out_bom[len(BOM):].split("\n")[1].startswith("title:"))

    # Trailing-newline presence preserved (absent stays absent).
    no_nl = "---\ncreated: 2024-01-01\ntitle: X\n---\nbody"
    check("no-trailing-newline-preserved", not reorder(no_nl).endswith("\n"))

    # Idempotency on a representative input.
    src = "---\ncreated: 2024-01-01\ntags:\n  - a\ntitle: X\n---\nbody\n"
    once = reorder(src)
    twice = reorder(once)
    check("idempotent", once == twice)
    check("idempotent-title-first", once.split("\n")[1].startswith("title:"))
    # `tags` must be the LAST top-level key inside the frontmatter (index-robust check).
    once_lines = once.split("\n")
    close_idx = once_lines.index("---", 1)
    fm_keys = [ln for ln in once_lines[1:close_idx] if ln and not ln[0].isspace()]
    check("idempotent-tags-last-block", fm_keys[-1].strip() == "tags:")

    return failures


# ─────────────────────────────────────────────────────────────────────────────
# Case runner: in.md -> reorder -> compare to expected.md; then idempotency.
# ─────────────────────────────────────────────────────────────────────────────
def _run_cases() -> tuple[int, int, list[str]]:
    passed = 0
    failed = 0
    msgs = []
    if not CASES_DIR.is_dir():
        return 0, 1, [f"cases dir missing: {CASES_DIR}"]
    for case in sorted(CASES_DIR.iterdir()):
        if not case.is_dir():
            continue
        in_f = case / "in.md"
        exp_f = case / "expected.md"
        if not in_f.exists() or not exp_f.exists():
            failed += 1
            msgs.append(f"FAIL {case.name}: missing in.md or expected.md")
            continue
        src = in_f.read_text(encoding="utf-8")
        expected = exp_f.read_text(encoding="utf-8")
        got = reorder(src)
        if got != expected:
            failed += 1
            msgs.append(f"FAIL {case.name}: reorder(in) != expected")
            msgs.append(f"  --- expected ---\n{expected!r}")
            msgs.append(f"  --- got ---\n{got!r}")
            continue
        # idempotency: reorder(expected) == expected
        again = reorder(expected)
        if again != expected:
            failed += 1
            msgs.append(f"FAIL {case.name}: NOT idempotent (reorder(expected) != expected)")
            msgs.append(f"  --- expected ---\n{expected!r}")
            msgs.append(f"  --- again ---\n{again!r}")
            continue
        passed += 1
        msgs.append(f"PASS {case.name}")
    return passed, failed, msgs


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "--file":
        text = Path(argv[2]).read_text(encoding="utf-8")
        sys.stdout.write(reorder(text))
        return 0

    passed, failed, msgs = _run_cases()
    for m in msgs:
        print(m)
    print()
    self_failures = _selftest()
    if self_failures:
        print("SELFTEST FAILURES: " + ", ".join(self_failures))
    else:
        print("SELFTEST: all invariants pass")
    print()
    print(f"cases PASS={passed} FAIL={failed}; selftest_failures={len(self_failures)}")
    return 0 if (failed == 0 and not self_failures) else 1


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
