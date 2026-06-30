'use strict';
// validate.test.js — apply-boundary guard for --from-recs sidecars (Slice 2).
// Tier 1 (universal): op.type in {rename,remove}; logicalKey(op.from) in inventory;
// isValidTag(op.to) for renames. Tier 2 (both-exist, DEFAULT for renames): logicalKey(op.to)
// must also be in inventory — the "never invent a target" guard — UNLESS the rec carries
// targetMayBeNew:true (engine-authored opt-out: buildRecommendations / buildNestRecommendations).
// A model-authored merge carries no marker -> strict both-exist (safety-by-default).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateRecs, RecValidationError } = require('../scripts/validate.js');

// Minimal inventory rows — validateRecs reads only r.key (already logicalKey'd, as
// buildInventory produces). A bare { key } object is a faithful stand-in.
const inv = (...keys) => keys.map((k) => ({ key: k }));

// ---- Tier 1 PASS cases (every engine rec shape survives unchanged) ---------

test('validateRecs PASS: convention case-fold (research -> Research)', () => {
  assert.doesNotThrow(() =>
    validateRecs([{ source: 'heuristic', ops: [{ type: 'rename', from: 'research', to: 'Research' }] }], inv('research')));
});

test('validateRecs PASS (BOUNDARY LOCK): engine separator-fold target absent from inventory', () => {
  // mercedes_benz -> Mercedes-Benz; logicalKey(to) = "mercedes-benz" is NOT in inventory
  // (only mercedes_benz + mercedesbenz present). An ENGINE rec (targetMayBeNew) opts out of
  // the both-exist check; Tier 1 still requires isValidTag(to).
  assert.doesNotThrow(() =>
    validateRecs([{ source: 'brand', targetMayBeNew: true, ops: [{ type: 'rename', from: 'mercedes_benz', to: 'Mercedes-Benz' }] }],
      inv('mercedes_benz', 'mercedesbenz')));
});

test('validateRecs PASS: engine nest rec to a NEW parent (Parent/Leaf, parent absent)', () => {
  assert.doesNotThrow(() =>
    validateRecs([{ source: 'hierarchy', targetMayBeNew: true, ops: [{ type: 'rename', from: 'daytrading', to: 'Investing/DayTrading' }] }],
      inv('daytrading')));
});

test('validateRecs PASS: removal rec (remove op, no `to`)', () => {
  assert.doesNotThrow(() =>
    validateRecs([{ source: 'numeric-artifact', ops: [{ type: 'remove', from: '1' }] }], inv('1')));
});

// ---- Tier 1 ABORT cases (universal hardening) ------------------------------

test('validateRecs ABORT: unknown op.type', () => {
  assert.throws(() =>
    validateRecs([{ source: 'x', ops: [{ type: 'frobnicate', from: 'a' }] }], inv('a')), RecValidationError);
});

test('validateRecs ABORT: op.from not in inventory (stale audit)', () => {
  assert.throws(() =>
    validateRecs([{ source: 'brand', ops: [{ type: 'rename', from: 'ghost', to: 'Ghost' }] }], inv('research')),
    RecValidationError);
});

test('validateRecs ABORT: rename target fails isValidTag (space)', () => {
  assert.throws(() =>
    validateRecs([{ source: 'heuristic', ops: [{ type: 'rename', from: 'research', to: 'Research Notes' }] }],
      inv('research')), RecValidationError);
});

// ---- Tier 2 cross-language (both-exist guard) ------------------------------

test('validateRecs PASS (Tier 2 both-exist): versicherung -> Insurance, both present', () => {
  assert.doesNotThrow(() =>
    validateRecs([{ source: 'cross-language', ops: [{ type: 'rename', from: 'versicherung', to: 'Insurance' }] }],
      inv('versicherung', 'insurance')));
});

test('validateRecs PASS (Tier 2): display-case from/to normalize via logicalKey', () => {
  // from:'Versicherung' to:'Insurance' while inventory holds lowercased keys -> both sides
  // pass through logicalKey, so membership still holds (no false abort).
  assert.doesNotThrow(() =>
    validateRecs([{ source: 'cross-language', ops: [{ type: 'rename', from: 'Versicherung', to: 'Insurance' }] }],
      inv('versicherung', 'insurance')));
});

test('validateRecs ABORT (HEADLINE RED): cross-language invented target (Insurance absent)', () => {
  assert.throws(() =>
    validateRecs([{ source: 'cross-language', ops: [{ type: 'rename', from: 'versicherung', to: 'Insurance' }] }],
      inv('versicherung')), RecValidationError);
});

test('validateRecs ABORT (SAFETY-BY-DEFAULT): unmarked model rename to invented target, NO source field', () => {
  // The inversion proof. A model that omits BOTH `source` and `targetMayBeNew` (forgetful or
  // adversarial) still gets the strict both-exist check — the v0 source-keyed guard let this WRITE.
  assert.throws(() =>
    validateRecs([{ kind: 'merge', ops: [{ type: 'rename', from: 'skalierung', to: 'Scaling' }] }],
      inv('skalierung')), RecValidationError);
});

// ---- Marker-gating twin (the explicit boundary proof) ----------------------

test('validateRecs MARKER-GATING: same not-in-inventory `to` aborts UNLESS targetMayBeNew', () => {
  const to = 'Investing/DayTrading'; // logicalKey absent from inventory {daytrading}
  const mk = (extra) => [{ ops: [{ type: 'rename', from: 'daytrading', to }], ...extra }];
  // No marker (model-authored): both-exist by default -> abort, regardless of any source label.
  assert.throws(() => validateRecs(mk({}), inv('daytrading')), RecValidationError);
  assert.throws(() => validateRecs(mk({ source: 'cross-language' }), inv('daytrading')), RecValidationError);
  // Engine marker present (nest/fold): opt out of both-exist -> no throw.
  assert.doesNotThrow(() => validateRecs(mk({ source: 'hierarchy', targetMayBeNew: true }), inv('daytrading')));
});

// ---- Empty / defensive -----------------------------------------------------

test('validateRecs PASS: empty rec list and rec with no ops are no-ops', () => {
  assert.doesNotThrow(() => validateRecs([], inv('a')));
  assert.doesNotThrow(() => validateRecs([{ source: 'x' }], inv('a')));
});

// ---- Integration: exit-2 / ABORTED via the CLI --from-recs boundary --------

function tmpDirWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagm-validate-'));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  return dir;
}

test('CLI apply --from-recs: cross-language invented target -> exit 2, ABORTED, nothing written', () => {
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const dir = tmpDirWith({ 'a.md': '---\ntags:\n  - Versicherung\n---\nbody\n' });
  try {
    // Versicherung exists; Insurance does NOT -> Tier 2 must abort.
    const recs = [{ kind: 'merge', source: 'cross-language',
      ops: [{ type: 'rename', from: 'versicherung', to: 'Insurance' }] }];
    const recsFile = path.join(dir, 'merges.json');
    fs.writeFileSync(recsFile, JSON.stringify(recs), 'utf8');

    const r = spawnSync('node', [cli, 'apply', dir, '--from-recs', recsFile, '--write'], { encoding: 'utf8' });
    assert.equal(r.status, 2, `expected exit 2, got ${r.status}\nstderr:${r.stderr}`);
    assert.match(r.stderr, /ABORTED/);
    // Nothing written: the original tag is untouched on disk.
    const after = fs.readFileSync(path.join(dir, 'a.md'), 'utf8');
    assert.ok(after.includes('Versicherung'), 'original tag must remain (no write)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI plan --from-recs --ids: validates only the SELECTED subset (stale unselected rec ignored)', () => {
  // DECISION 1: validateRecs runs on `picked`, not the whole file. A partial --ids apply must
  // NOT abort because an UNSELECTED rec went stale (its `from` no longer resolves).
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const dir = tmpDirWith({ 'a.md': '---\ntags:\n  - research\n---\nbody\n' });
  try {
    const recs = [
      { id: 1, source: 'heuristic', ops: [{ type: 'rename', from: 'research', to: 'Research' }] }, // valid, selected
      { id: 2, source: 'heuristic', ops: [{ type: 'rename', from: 'ghost', to: 'Ghost' }] },       // stale, NOT selected
    ];
    const recsFile = path.join(dir, 'recs.json');
    fs.writeFileSync(recsFile, JSON.stringify(recs), 'utf8');

    const r = spawnSync('node', [cli, 'plan', dir, '--from-recs', recsFile, '--ids', '1'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `expected exit 0 (stale rec 2 unselected), got ${r.status}\nstderr:${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI plan --from-recs: cross-language both-exist target -> exit 0 (no abort)', () => {
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const dir = tmpDirWith({ 'a.md': '---\ntags:\n  - Versicherung\n  - Insurance\n---\nbody\n' });
  try {
    const recs = [{ kind: 'merge', source: 'cross-language',
      ops: [{ type: 'rename', from: 'versicherung', to: 'Insurance' }] }];
    const recsFile = path.join(dir, 'merges.json');
    fs.writeFileSync(recsFile, JSON.stringify(recs), 'utf8');

    const r = spawnSync('node', [cli, 'plan', dir, '--from-recs', recsFile], { encoding: 'utf8' });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr:${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI plan --from-recs (NFC/NFD): NFD-stored German `from` + NFC sidecar -> exit 0, no false abort', () => {
  // Finding 1 regression: the vault stores the umlaut DECOMPOSED (NFD: o + U+0308) — the macOS /
  // Apple-Notes form — while the sidecar `from` is COMPOSED (NFC: U+00F6), as an LLM emits. Without
  // NFC normalization in logicalKey, the Tier-1 from-membership test misses and the whole DE<->EN
  // batch hard-aborts on a tag that is plainly present. Both halves exist -> must plan cleanly.
  const cli = path.join(__dirname, '..', 'scripts', 'cli.js');
  const base = 'F\u00f6rdermittel';   // ASCII-safe source; \u00f6 = composed o-umlaut
  const nfd = base.normalize('NFD');    // F o U+0308 ...  (what macOS / Apple-Notes store)
  const nfc = base.normalize('NFC');    // F U+00F6 ...    (what an LLM emits in JSON)
  assert.notEqual(nfd, nfc, 'precondition: NFD and NFC byte-forms must differ');
  const dir = tmpDirWith({ 'a.md': `---\ntags:\n  - ${nfd}\n  - Funding\n---\nbody\n` });
  try {
    const recs = [{ kind: 'merge', source: 'cross-language',
      ops: [{ type: 'rename', from: nfc, to: 'Funding' }] }];
    const recsFile = path.join(dir, 'merges.json');
    fs.writeFileSync(recsFile, JSON.stringify(recs), 'utf8');

    const r = spawnSync('node', [cli, 'plan', dir, '--from-recs', recsFile], { encoding: 'utf8' });
    assert.equal(r.status, 0, `expected exit 0 (NFD/NFC must reconcile), got ${r.status}\nstderr:${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
