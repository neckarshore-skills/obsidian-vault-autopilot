#!/usr/bin/env bash
# CI bridge: runs the ai-paste-cleanup node:test suites. Picked up by the
# existing scripts/test-*.sh loop in .github/workflows/test.yml -- no workflow
# edit needed. Exits non-zero if any test fails.
#
# NOTE: uses the *.test.js glob, not a bare directory. On Node v26 the
# `node --test <dir>/` form fails (the path is resolved as a module), so the
# explicit glob is required for forward-compatibility.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test skills/ai-paste-cleanup/tests/*.test.js
