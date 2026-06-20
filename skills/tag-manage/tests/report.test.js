const { renderReport } = require('../scripts/report.js');
const test = require('node:test');
const assert = require('node:assert/strict');

const data = {
  scope: 'Vault-wide', date: '2026-06-20',
  analysis: { totalNotes: 3, taggedNotes: 2, untaggedNotes: 1, uniqueTags: 3, totalAssignments: 4, avgTagsPerNote: 2, maxDepth: 2,
    topN: [{ display: 'AI', noteCount: 2, pct: 100 }], depthDistribution: { 1: 2, 2: 1 }, singletons: [{ key: 'research', display: 'Research', noteCount: 1 }], lowUsage: [] },
  findings: { caseGroups: [], separatorGroups: [], numericArtifacts: [], otherInvalidTags: [] },
  recommendations: [{ id: 1, kind: 'rename', severity: 'MEDIUM', from: 'research', to: 'Research', notesAffected: 1, source: 'heuristic', ops: [] }],
  healthScore: { conformityPct: 80, coveragePct: 67, singletonRatioPct: 33 },
};

test('renderReport is deterministic and contains key sections', () => {
  const md = renderReport(data);
  assert.match(md, /Tag Analysis Report/);
  assert.match(md, /2026-06-20/);
  assert.match(md, /Health Score/);
  assert.match(md, /verify casing/); // heuristic-sourced rec flagged
  assert.equal(md, renderReport(data)); // deterministic
});
