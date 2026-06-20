'use strict';
// analysis.js — pure frequency/coverage/depth aggregation over a tag inventory.
const { noteTags } = require('./tags.js');

function analyze(notes, inventory) {
  const totalNotes = notes.length;
  const taggedNotes = notes.filter((n) => noteTags(n.text).length > 0).length;
  const totalAssignments = inventory.reduce((s, r) => s + r.noteCount, 0);
  const sorted = [...inventory].sort((a, b) => b.noteCount - a.noteCount || (a.key < b.key ? -1 : 1));
  const topN = sorted.slice(0, 20).map((r) => ({
    display: r.display, noteCount: r.noteCount,
    pct: taggedNotes ? Math.round((r.noteCount / taggedNotes) * 100) : 0,
  }));
  const depthOf = (k) => k.split('/').length;
  const depthDistribution = {};
  for (const r of inventory) { const d = depthOf(r.key); depthDistribution[d] = (depthDistribution[d] || 0) + 1; }
  const maxDepth = inventory.reduce((m, r) => Math.max(m, depthOf(r.key)), 0);
  const singletons = inventory.filter((r) => r.noteCount === 1).map((r) => ({ key: r.key, display: r.display, noteCount: 1 }));
  const lowUsage = inventory.filter((r) => r.noteCount >= 2 && r.noteCount <= 3).map((r) => ({ key: r.key, display: r.display, noteCount: r.noteCount }));
  return {
    totalNotes, taggedNotes, untaggedNotes: totalNotes - taggedNotes,
    uniqueTags: inventory.length, totalAssignments,
    avgTagsPerNote: taggedNotes ? Math.round((totalAssignments / taggedNotes) * 10) / 10 : 0,
    maxDepth, topN, depthDistribution, singletons, lowUsage,
  };
}

module.exports = { analyze };
