#!/usr/bin/env bash
# CI bridge: runs the skill-library-sync node:test suites. Picked up by the
# scripts/test-*.sh loop in .github/workflows/test.yml -- no workflow edit needed.
# Uses the *.test.js glob, not a bare directory: on Node v26 the directory form
# resolves the path as a module and fails.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test skills/skill-library-sync/tests/*.test.js
