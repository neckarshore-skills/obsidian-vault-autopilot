'use strict';

// Reference implementation of the documented skill-log tag + callout-append recipe
// (references/skill-log.md "Idempotency Rules" + references/yaml-edits.md recipes a/d/e).
//
// Line-by-line, exact-string boundary matching ONLY — never a regex over the joined
// text. This is the F8/F15 lesson codified in yaml-edits.md: ad-hoc multi-line regexes
// were the shared root cause of two production callout/tag-append bugs.
//
// TEST-SCOPE ONLY. note-rename is instruction-driven (no shipped script); this module
// exists so the documented contract can be pinned by an automated regression suite.
// It is NOT the runtime path and is not loaded by any skill.
//
// Row format: this impl writes the caller-supplied `entry.date` verbatim and follows
// note-rename/SKILL.md Step 9, whose template is DATE-ONLY (`YYYY-MM-DD`). Note the
// documented divergence: references/skill-log.md § Format declares `YYYY-MM-DD HH:MM`
// canonical. The two docs disagree, and that disagreement is the root of the dedup
// granularity (date-only → at most one duplicate row per day; HH:MM → one per run).
// Surfaced to MASCHIN as a cross-skill finding; this suite does not pick a winner.
//
// applySkillLog also normalizes trailing blank lines to a single trailing newline.
// That is an implementation convenience for stable re-runs, NOT documented note-rename
// behavior — do not read it as the skill's real trailing-whitespace policy.

const TAG = 'VaultAutopilot';
const CALLOUT_HEADER = '> [!info] Vault Autopilot';
const TABLE_HEAD = '> | Date | Skill | Action |';
const TABLE_SEP = '> |------|-------|--------|';

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

// Split on LF and strip a trailing CR per line (CRLF-safe). Round-trips with join(eol).
function splitLines(text) {
  return text.split('\n').map((l) => l.replace(/\r$/, ''));
}

function stripBom(line) {
  return line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
}

// Returns [openIdx, closeIdx] of the frontmatter ---...--- fence, or null.
// Per yaml-edits.md recipe (a): a lone opening --- with no close is NOT frontmatter.
function frontmatterBounds(lines) {
  if (lines.length === 0 || stripBom(lines[0]) !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') return [0, i];
  }
  return null;
}

function rowFor(entry) {
  return `> | ${entry.date} | ${entry.skill} | ${entry.action} |`;
}

// --- Tag (idempotent) — skill-log.md § Tag + Idempotency Rule 1 -----------------------
function ensureTag(lines) {
  const bounds = frontmatterBounds(lines);

  if (!bounds) {
    // No frontmatter: create one with a tags block (recipe c "if none, create one").
    return ['---', 'tags:', `  - ${TAG}`, '---', ''].concat(lines);
  }

  const [, closeIdx] = bounds;

  // Find a tags line inside the frontmatter (exact-ish, single-line — safe).
  let tagsIdx = -1;
  for (let i = 1; i < closeIdx; i++) {
    const t = lines[i].trimStart();
    if (t === 'tags:' || t.startsWith('tags:')) { tagsIdx = i; break; }
  }

  if (tagsIdx === -1) {
    // No tags field: insert a block just before the close fence.
    const out = lines.slice();
    out.splice(closeIdx, 0, 'tags:', `  - ${TAG}`);
    return out;
  }

  const tagsLine = lines[tagsIdx];
  const afterColon = tagsLine.slice(tagsLine.indexOf('tags:') + 'tags:'.length).trim();

  if (afterColon.startsWith('[')) {
    // Inline format → convert to block (skill-log.md: always WRITE block format).
    const inner = afterColon.replace(/^\[/, '').replace(/\]$/, '');
    const items = inner.split(',').map((s) => s.trim()).filter(Boolean);
    if (!items.includes(TAG)) items.push(TAG);
    const block = ['tags:', ...items.map((i) => `  - ${i}`)];
    const out = lines.slice();
    out.splice(tagsIdx, 1, ...block);
    return out;
  }

  // Block format: collect the `  - X` lines following `tags:`.
  let end = tagsIdx + 1;
  const existing = [];
  while (end < closeIdx && /^\s*-\s+/.test(lines[end])) {
    existing.push(lines[end].replace(/^\s*-\s+/, '').trim());
    end++;
  }
  if (existing.includes(TAG)) return lines; // Rule 1: never duplicate.
  const out = lines.slice();
  out.splice(end, 0, `  - ${TAG}`);
  return out;
}

// --- Callout (append-only) — skill-log.md § Callout + Idempotency Rules 2-4 -----------
function ensureCallout(lines, entry) {
  const row = rowFor(entry);

  // Detect the callout by its header line (Rule 2). It is the LAST block (Rule 1),
  // so search from the end.
  let headerIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === CALLOUT_HEADER) { headerIdx = i; break; }
  }

  if (headerIdx === -1) {
    // Create the full block, separated by exactly one blank line (§ Rules 6).
    return lines.concat(['', CALLOUT_HEADER, '>', TABLE_HEAD, TABLE_SEP, row]);
  }

  // Existing callout: Rule 3 — never add an identical row (same date+skill+action).
  for (let i = headerIdx; i < lines.length; i++) {
    if (lines[i] === row) return lines;
  }
  // Rule 4 — different action (or different date): append a new row at the end.
  return lines.concat([row]);
}

function applySkillLog(text, entry) {
  const eol = detectEol(text);
  let lines = splitLines(text);
  // Normalize trailing blank lines away; re-add exactly one at the end (single trailing
  // newline). Keeps the "callout is the last block" invariant and makes re-runs stable.
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines = ensureTag(lines);
  lines = ensureCallout(lines, entry);
  lines.push('');
  return lines.join(eol);
}

module.exports = { applySkillLog, ensureTag, ensureCallout, TAG, CALLOUT_HEADER };
