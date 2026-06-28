#!/usr/bin/env bash
# scripts/test-readme-install-blocks.sh
#
# Regression test for README install-block structural defect (2026-05-15).
#
# Empirical bug it guards against:
#   The README ships install instructions as two slash-commands inside a single
#   fenced code block. Users who select-all-copy-paste the whole code block into
#   the Claude Code prompt submit BOTH commands as a single chat input. Claude
#   Code then treats the entire multi-line string as the argument to `/plugin
#   marketplace add`, mangles it into a directory name, and the clone falls
#   back to SSH which fails for users without configured SSH keys (observed:
#   "git@github.com: Permission denied (publickey)").
#
# Verified on 2026-05-15: single-line shorthand
#   `claude plugin marketplace add neckarshore-skills/neckarshore-plugins`
# succeeds (CC logs "SSH not configured, cloning via HTTPS" and falls through
# to HTTPS). The defect is the README shape, not the URL form.
#
# What it asserts:
#   No `*.md` file in the repo contains a single ```bash fenced block that
#   holds two-or-more `/plugin ...` lines. Install commands must be presented
#   one-per-fence with prose between them so copy-paste cannot accidentally
#   submit two slash-commands as one chat input.
#
# Exit 0 on PASS. Exit 1 on first defect with file:line context.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

while IFS= read -r -d '' file; do
  # Skip vendored / node_modules / cache paths if any appear.
  case "$file" in
    ./node_modules/*|./.git/*) continue ;;
  esac

  # awk: walk each ```bash fence, count /plugin lines inside. First fence with
  # 2+ /plugin lines = defect. Print file:line of the second hit and exit 1.
  if ! awk -v path="$file" '
    /^```bash[[:space:]]*$/ { in_fence=1; count=0; fence_start=NR; next }
    /^```[[:space:]]*$/ && in_fence { in_fence=0; next }
    in_fence && /^\/plugin([[:space:]]|$)/ {
      count++
      if (count >= 2) {
        printf "DEFECT: %s:%d — fence starting at line %d contains %d /plugin commands; split into separate fences\n", path, NR, fence_start, count
        exit 1
      }
    }
  ' "$file"; then
    FAIL=1
  fi
done < <(find . -type f -name '*.md' -not -path './node_modules/*' -not -path './.git/*' -print0)

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "FAIL: README install-block structural defect present."
  echo "Fix: split each multi-/plugin fence into one fence per command, with a"
  echo "short prose line between them, so copy-paste cannot submit both as one"
  echo "chat input."
  exit 1
fi

echo "PASS: no Markdown bash fence contains 2+ /plugin commands."
exit 0
