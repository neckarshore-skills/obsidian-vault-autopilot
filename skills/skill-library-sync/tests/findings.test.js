'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeFindings } = require('../scripts/cli.js');

const RESULT = { written: ['/v/a.md'], moved: ['/v/Entfallen/b.md'], renamed: ['Skill – c (eigen)'], unchanged: 12, conflicts: [] };

test('the ledger lands at the documented path', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find-'));
  const out = writeFindings(v, RESULT, { now: new Date('2026-08-26T12:00:00Z') });
  assert.strictEqual(out, path.join(v, '_vault-autopilot', 'findings', '2026-08-26-skill-library-sync.md'));
  assert.ok(fs.existsSync(out));
});

test('the ledger carries the machine schema, not title/description/tags', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find2-'));
  const text = fs.readFileSync(writeFindings(v, RESULT, { now: new Date('2026-08-26T12:00:00Z') }), 'utf8');
  assert.match(text, /^date: 2026-08-26$/m);
  assert.match(text, /^skill: skill-library-sync$/m);
  assert.match(text, /^counts:$/m);
  assert.doesNotMatch(text, /^description:/m);
});

test('a second run on the same day appends rather than overwrites', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find3-'));
  const now = new Date('2026-08-26T12:00:00Z');
  writeFindings(v, RESULT, { now });
  const out = writeFindings(v, { ...RESULT, unchanged: 99 }, { now });
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /unchanged: 12/);
  assert.match(text, /unchanged: 99/);
});

// --- Extension: the conflicts channel (RULING, overrides the brief) ---

test('a conflict is named in the ledger, not silently dropped', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find4-'));
  const result = {
    ...RESULT,
    conflicts: [{ kind: 'unstammable-note-typo-guard', detail: { path: '/v/library/broken.md', missing: ['title'] } }],
  };
  const text = fs.readFileSync(writeFindings(v, result, { now: new Date('2026-08-26T12:00:00Z') }), 'utf8');
  assert.match(text, /^  conflicts: 1$/m);
  assert.match(text, /unstammable-note-typo-guard/);
  assert.match(text, /\/v\/library\/broken\.md/);
});

test('a conflict whose detail lacks the rendered field does not print "undefined"', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find5-'));
  const result = {
    ...RESULT,
    conflicts: [{ kind: 'mystery-kind', detail: {} }, { kind: 'no-detail-at-all' }],
  };
  const text = fs.readFileSync(writeFindings(v, result, { now: new Date('2026-08-26T12:00:00Z') }), 'utf8');
  assert.doesNotMatch(text, /undefined/);
  assert.match(text, /mystery-kind/);
  assert.match(text, /no-detail-at-all/);
});

test('a zero-conflict run still renders a conflicts count of 0', () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-find6-'));
  const text = fs.readFileSync(writeFindings(v, RESULT, { now: new Date('2026-08-26T12:00:00Z') }), 'utf8');
  assert.match(text, /^  conflicts: 0$/m);
});
