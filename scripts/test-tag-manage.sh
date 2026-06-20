#!/usr/bin/env bash
# CI bridge: runs the tag-manage node:test suites. Picked up by the existing
# scripts/test-*.sh loop in .github/workflows/test.yml -- no workflow edit needed.
# Exits non-zero if any test fails.
#
# Uses the explicit *.test.js glob (not a bare directory): on Node v26 the
# `node --test <dir>/` form resolves the path as a module and fails.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test skills/tag-manage/tests/*.test.js
