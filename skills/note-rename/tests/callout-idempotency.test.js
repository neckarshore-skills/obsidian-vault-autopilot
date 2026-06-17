'use strict';

// Regression suite for the skill-log tag + callout-append idempotency contract
// (references/skill-log.md "Idempotency Rules" + references/yaml-edits.md recipes d/e),
// exercised through note-rename's documented Step-9 procedure (skills/note-rename/SKILL.md).
//
// O3 "note-rename Run 2 (Callout-Append-Idempotency)": Run 1 was the GR-4 launch
// live-run; Run 2 is this post-launch *automated* guard that a re-run of note-rename
// on an already-processed note never duplicates the tag or the callout.
//
// LIMITATION (honest): note-rename is an instruction-only skill (no shipped script).
// `callout-ref.js` is a REFERENCE implementation of the documented line-by-line recipe,
// not the runtime path. This suite pins the *spec* deterministically; it does not test
// the LLM's execution of the spec. Same self-referential limitation as
// scripts/test-property-classify.sh ("truth never bends to implementation").

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { applySkillLog, CALLOUT_HEADER } = require('./callout-ref.js');

const REVIEW = { date: '2026-06-17', skill: 'note-rename', action: 'Reviewed — name already descriptive' };
const RENAME = { date: '2026-06-17', skill: 'note-rename', action: 'Renamed from Untitled' };

const count = (text, needle) => text.split(needle).length - 1;
const calloutHeaders = (text) => text.split('\n').filter((l) => l === CALLOUT_HEADER).length;
const tagLines = (text) => text.split('\n').filter((l) => l.trim() === '- VaultAutopilot').length;

// ── Core idempotency (skill-log.md Rules 1-3) ────────────────────────────────────────

test('double-apply of an identical entry is a no-op (skill-log Rules 1-3)', () => {
  const note = '# My Note\n\nSome content.\n';
  const once = applySkillLog(note, REVIEW);
  const twice = applySkillLog(once, REVIEW);
  assert.equal(twice, once, 're-applying the same entry must not change the note');
});

test('tag is added exactly once, even across re-runs (Rule 1)', () => {
  const note = '---\ntitle: X\n---\n\nBody.\n';
  const out = applySkillLog(applySkillLog(note, REVIEW), REVIEW);
  assert.equal(tagLines(out), 1, 'VaultAutopilot must appear exactly once');
});

test('inline tags are converted to block format and not duplicated (Rule 1)', () => {
  const note = '---\ntags: [AppleNoteImport, Obsidian]\n---\n\nBody.\n';
  const once = applySkillLog(note, REVIEW);
  assert.match(once, /tags:\n  - AppleNoteImport\n  - Obsidian\n  - VaultAutopilot/, 'inline → block + tag');
  assert.equal(applySkillLog(once, REVIEW), once, 'second run is a no-op');
});

test('an already-present VaultAutopilot tag is left untouched (Rule 1)', () => {
  const note = '---\ntags:\n  - VaultAutopilot\n---\n\nBody.\n';
  const out = applySkillLog(note, REVIEW);
  assert.equal(tagLines(out), 1, 'no duplicate tag');
});

// ── Callout append-only (skill-log.md Rules 2 + 4) ───────────────────────────────────

test('a second callout block is never created — only rows are appended (Rule 2)', () => {
  const note = '# N\n\nBody.\n';
  const once = applySkillLog(note, REVIEW);
  const twiceDifferent = applySkillLog(once, RENAME);
  assert.equal(calloutHeaders(twiceDifferent), 1, 'exactly one callout header after a different-action re-run');
});

test('a different action on the same day appends a new row (Rule 4 — history)', () => {
  const note = '# N\n\nBody.\n';
  const out = applySkillLog(applySkillLog(note, REVIEW), RENAME);
  assert.ok(out.includes(`| ${REVIEW.date} | note-rename | ${REVIEW.action} |`), 'review row kept');
  assert.ok(out.includes(`| ${RENAME.date} | note-rename | ${RENAME.action} |`), 'rename row added');
});

test('the callout stays the last block — no content follows it', () => {
  const note = '# N\n\nBody.\n';
  const out = applySkillLog(note, REVIEW).replace(/\n+$/, '');
  const lines = out.split('\n');
  const headerIdx = lines.indexOf(CALLOUT_HEADER);
  assert.ok(headerIdx !== -1, 'callout present');
  for (let i = headerIdx; i < lines.length; i++) {
    assert.ok(lines[i].startsWith('>'), `line ${i} after the callout header must be part of the callout, got: ${lines[i]}`);
  }
});

// ── CHARACTERIZATION: the timestamp-granularity hole (NOT a desired-state assertion) ──
// skill-log.md Rule 3 dedups on `date + skill + action`. note-rename writes DATE-ONLY
// rows (SKILL.md Step 9), so the SAME no-op action re-run on a LATER DAY is NOT an
// identical row → a new row is appended. A weekly re-run of an unchanged, already-
// descriptive note accumulates one "Reviewed" row per day it runs (unbounded growth).
// This test PINS the current behavior so any future change to the dedup key is a
// deliberate, visible diff. See FOR-MASCHIN finding (cross-skill: all 6 callout skills).
test('CHARACTERIZATION: same action on a LATER day adds a row (current date-keyed dedup)', () => {
  const note = '# N\n\nBody.\n';
  const day1 = applySkillLog(note, { ...REVIEW, date: '2026-06-10' });
  const day2 = applySkillLog(day1, { ...REVIEW, date: '2026-06-17' });
  assert.equal(count(day2, '| note-rename | Reviewed — name already descriptive |'), 2,
    'current behavior: a second identical-action row is added on a new date (the hole)');
  assert.equal(calloutHeaders(day2), 1, 'still a single callout block');
});

test('CRLF line endings are preserved and the re-run stays stable', () => {
  const note = '---\r\ntitle: X\r\n---\r\n\r\nBody.\r\n';
  const once = applySkillLog(note, REVIEW);
  assert.ok(once.includes('\r\n'), 'CRLF preserved');
  assert.ok(!/[^\r]\n/.test(once), 'no bare LF introduced');
  assert.equal(applySkillLog(once, REVIEW), once, 'second run is a no-op on CRLF input');
});

// ── Spec-claim pins: the documented contract must stay in the docs ───────────────────

test('skill-log.md still documents the idempotency contract', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'references', 'skill-log.md'), 'utf8');
  assert.match(doc, /Idempotency Rules/, 'Idempotency Rules section present');
  assert.match(doc, /never create a second callout block/i, 'Rule 2 wording present');
  assert.match(doc, /Do not duplicate identical rows/i, 'Rule 3 wording present');
});

test('note-rename SKILL.md still binds the callout idempotency claims', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.match(doc, /Never create a second callout\./, 'append-only claim present');
  assert.match(doc, /Re-renamed notes have multiple callout rows, not multiple callouts/, 'quality-check pin present');
});
