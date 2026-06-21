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

// --- Findings section tests ---

const richData = {
  scope: 'Vault-wide', date: '2026-06-20',
  analysis: {
    totalNotes: 10, taggedNotes: 8, untaggedNotes: 2, uniqueTags: 6,
    totalAssignments: 12, avgTagsPerNote: 1.5, maxDepth: 2,
    topN: [{ display: 'AI', noteCount: 5, pct: 62 }],
    depthDistribution: { 1: 4, 2: 2 },
    singletons: [
      { key: 'research', display: 'Research', noteCount: 1 },
      { key: 'drafts', display: 'Drafts', noteCount: 1 },
    ],
    lowUsage: [
      { key: 'projects', display: 'Projects', noteCount: 2 },
    ],
  },
  findings: {
    caseGroups: [{ key: 'ai', variants: ['ai', 'AI'] }],
    separatorGroups: [{ key: 'machinelearning', variants: ['machine-learning', 'machine_learning'] }],
    numericArtifacts: ['2024'],
    otherInvalidTags: ['bad tag'],
  },
  recommendations: [],
  healthScore: { conformityPct: 90, coveragePct: 80, singletonRatioPct: 25 },
};

test('renderReport Findings section — rich fixture', () => {
  const md = renderReport(richData);
  // section exists and is positioned before Recommendations
  assert.match(md, /## Findings/);
  const findingsIdx = md.indexOf('## Findings');
  const recsIdx = md.indexOf('## Recommendations');
  assert.ok(findingsIdx < recsIdx, 'Findings must appear before Recommendations');
  // duplicate variants present
  assert.match(md, /`ai`.*`AI`|`AI`.*`ai`/s); // either order, escaped pipes
  assert.match(md, /machine-learning/);
  // invalid tags flagged
  assert.match(md, /2024/);
  assert.match(md, /bad tag/);
  // singletons
  assert.match(md, /\b2\b.*singleton|singleton.*\b2\b/si);
  assert.match(md, /Research/);
  // low-usage
  assert.match(md, /Projects/);
  // deterministic
  assert.equal(md, renderReport(richData));
});

const emptyFindingsData = {
  scope: 'Vault-wide', date: '2026-06-20',
  analysis: {
    totalNotes: 1, taggedNotes: 1, untaggedNotes: 0, uniqueTags: 1,
    totalAssignments: 1, avgTagsPerNote: 1, maxDepth: 1,
    topN: [{ display: 'AI', noteCount: 1, pct: 100 }],
    depthDistribution: { 1: 1 },
    singletons: [],
    lowUsage: [],
  },
  findings: {
    caseGroups: [], separatorGroups: [],
    numericArtifacts: [], otherInvalidTags: [],
  },
  recommendations: [],
  healthScore: { conformityPct: 100, coveragePct: 100, singletonRatioPct: 0 },
};

test('renderReport Findings section — empty findings degrade to None.', () => {
  const md = renderReport(emptyFindingsData);
  assert.match(md, /## Findings/);
  // each sub-part renders "None."
  const findingsBlock = md.slice(md.indexOf('## Findings'), md.indexOf('## Recommendations'));
  const noneCount = (findingsBlock.match(/None\./g) || []).length;
  assert.ok(noneCount >= 3, `Expected at least 3 "None." in Findings block, got ${noneCount}`);
  // must not throw
  assert.doesNotThrow(() => renderReport(emptyFindingsData));
});

// --- v2(e): thousand separators on large integer counts ---

// --- OBI-2026-06-21-2: report self-poisoning guard ---
// obsidian-linter (move-tags-to-yaml) promotes any tag-shaped `#token` found in the
// report PROSE into the report's OWN frontmatter as a tag, silently corrupting it on
// every save (the user deletes the integers, the linter writes them back). The fix is
// to emit no `#`-followed-by-a-tag-char token anywhere in the report. This guard pins
// that: across every fixture, renderReport output must contain no `#[\w/-]` token.
test('report emits no tag-shaped #token (obsidian-linter self-poisoning guard, OBI-2026-06-21-2)', () => {
  for (const fixture of [data, richData, emptyFindingsData]) {
    const md = renderReport(fixture);
    const m = md.match(/#[\w/-]/);
    assert.equal(
      m,
      null,
      `report must contain no tag-shaped #token (scope=${fixture.scope}); found "${m ? md.slice(m.index, m.index + 14) : ''}"`
    );
  }
});

test('v2(e): large integer counts render with thousand separators', () => {
  const big = {
    ...data,
    analysis: {
      ...data.analysis,
      totalNotes: 1272, taggedNotes: 1127, uniqueTags: 1469, totalAssignments: 5019,
      singletons: Array.from({ length: 1004 }, (_, i) => ({ key: `k${i}`, display: `K${i}`, noteCount: 1 })),
    },
  };
  const md = renderReport(big);
  assert.match(md, /1,272/);
  assert.match(md, /1,469/);
  assert.match(md, /5,019/);
  assert.match(md, /1,004/); // singleton count
  assert.doesNotMatch(md, /\b1272\b/, 'raw un-separated 1272 must not appear');
  assert.equal(md, renderReport(big)); // still deterministic
});
