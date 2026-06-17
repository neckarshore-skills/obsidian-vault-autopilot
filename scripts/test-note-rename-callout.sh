#!/usr/bin/env bash
# CI bridge: runs the note-rename skill-log callout/tag idempotency suite (O3 "Run 2",
# a post-launch regression guard). Picked up by the scripts/test-*.sh loop in
# .github/workflows/test.yml -- no workflow edit needed. Exits non-zero on any failure.
#
# NOTE: uses the *.test.js glob, not a bare directory. On Node v26 the
# `node --test <dir>/` form fails (the path is resolved as a module), so the
# explicit glob is required for forward-compatibility.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test skills/note-rename/tests/*.test.js
