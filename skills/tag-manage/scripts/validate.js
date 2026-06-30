'use strict';
// validate.js — apply-boundary guard for --from-recs sidecars (model- OR engine-authored).
// Pure: no fs, no clock. Throws on the first violation so cli.js's catch prints ABORTED and
// exits non-zero — the same fail-closed contract as the survival + mass-change guards.
//
// Two tiers (authoritative design: docs/.../2026-06-28-tag-low-frequency-review-design.md,
// "Slice 2 v1"):
//   Tier 1 (universal, hardens EVERY sidecar): op.type in {rename,remove}; logicalKey(op.from)
//     resolves to a real tag in the live inventory; isValidTag(op.to) for renames.
//   Tier 2 (both-exist, the DEFAULT for renames): logicalKey(op.to) must ALSO exist — the
//     "never invent a target" guard — UNLESS the rec carries `targetMayBeNew: true`.
//
// SAFETY-BY-DEFAULT (inverted from the original source-keyed v0 after a review proved that
// bypassable — see the spec's Slice 2 build resolution). The opt-out `targetMayBeNew` is stamped
// ONLY by the ENGINE rec builders whose target is legitimately new: buildRecommendations
// (a computed canonical fold/rename) and buildNestRecommendations (a Parent/Leaf slash path).
// A MODEL-authored cross-language merge sidecar carries no such marker, so a forgetful OR
// adversarial model that omits/mislabels fields gets the STRICT both-exist check, not a bypass.
// The escape now depends on an engine-authored field the model is never instructed to write;
// `source` is reporting metadata only, no longer load-bearing for safety.
//
// KNOWN_OP_TYPES is intentionally narrower than applyOps' {rename,merge,remove}: no rec builder
// emits a 'merge'-TYPE op, and a DE<->EN merge is mechanically a 'rename' op. A future engine rec
// that legitimately needs another op type must widen this allowlist in lockstep.
const { logicalKey, isValidTag } = require('./tags.js');

const KNOWN_OP_TYPES = new Set(['rename', 'remove']);

class RecValidationError extends Error {
  constructor(message) {
    super(`Rec validation: ${message}. Aborting; nothing written.`);
    this.name = 'RecValidationError';
  }
}

// recs: SELECTED rec objects ({ kind, source, ops, targetMayBeNew?, ... }) — validate BEFORE
// selectOps flattens rec metadata away. inventory: buildInventory(notes) output; r.key is already
// logicalKey'd. NEVER read rec.from/rec.to (those are display joins like "DayTrading, daytrading");
// operate on op.from/op.to inside rec.ops, with logicalKey on BOTH sides of every membership test.
function validateRecs(recs, inventory) {
  const keySet = new Set((inventory || []).map((r) => r.key));
  for (const rec of recs || []) {
    // Engine-authored opt-out from the both-exist guard (set only by buildRecommendations /
    // buildNestRecommendations). Anything a model authors lacks it -> strict both-exist.
    const targetMayBeNew = rec.targetMayBeNew === true;
    for (const op of rec.ops || []) {
      // Tier 1 — universal.
      if (!KNOWN_OP_TYPES.has(op.type)) {
        throw new RecValidationError(`unknown op type "${op.type}" (allowed: ${[...KNOWN_OP_TYPES].join(', ')})`);
      }
      if (!keySet.has(logicalKey(op.from))) {
        throw new RecValidationError(`op "from" tag "${op.from}" does not exist in the live inventory`);
      }
      if (op.type === 'rename') {
        if (!isValidTag(op.to)) {
          throw new RecValidationError(`rename target "${op.to}" is not a well-formed tag`);
        }
        // Tier 2 — both-exist by DEFAULT; engine recs opt out via targetMayBeNew. A model-authored
        // rename to a target absent from the vault is rejected here (never invent a target).
        if (!targetMayBeNew && !keySet.has(logicalKey(op.to))) {
          throw new RecValidationError(`merge target "${op.to}" does not exist in the live inventory (never invent a target; engine recs may opt out via targetMayBeNew)`);
        }
      }
    }
  }
}

module.exports = { validateRecs, RecValidationError };
