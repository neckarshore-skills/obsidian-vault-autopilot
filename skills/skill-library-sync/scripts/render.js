'use strict';
// render.js — pure rendering of a Skill Library note and of the index.

const { NOTES_HEADING, STUB, frontmatterBlocks, listItems } = require('./library.js');

const DESCRIPTION_CAP = 500;

// The library's existing notes are cut at ~300 characters wherever the character
// landed -- "give this a be". Cutting on a word boundary costs one regex and is
// the difference between a note that reads and a note that embarrasses.
function fitDescription(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= DESCRIPTION_CAP) return s;
  const cut = s.slice(0, DESCRIPTION_CAP - 1);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

function noteTitle({ name, suffix }) {
  return suffix ? `Skill – ${name} (${suffix})` : `Skill – ${name}`;
}

function yamlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// The keys this renderer OWNS: it derives them from the inventory, so it also
// replaces them. Everything else in a note's frontmatter is the user's.
const OWNED_KEYS = new Set([
  'title', 'type', 'description', 'herkunft', 'ort', 'plugin', 'status',
  'created', 'last_modified', 'tags',
]);

// `Claude/ClaudeCode` and `Skill/<herkunft>` are generated. The origin tag has
// to be OWNED rather than carried: a relocate can change `herkunft`, and a
// carried-through `Skill/extern` would leave the note tagged with an origin it
// no longer has. Owning these two is exactly what makes carrying the rest safe.
function isGeneratedTag(tag) {
  return tag === 'Claude/ClaudeCode' || /^Skill\//.test(tag);
}

// Splits an existing note's frontmatter into what this renderer must carry
// through: every block it does not own, verbatim, plus the tags that are not
// generated. Issue #91 -- a create or relocate used to replace the whole block,
// so a user's own key or tag was gone with no conflict, no warning, exit 0.
function carryFrontmatter(frontmatterRaw) {
  const blocks = frontmatterBlocks(frontmatterRaw);
  const tagBlock = blocks.find((b) => b.key === 'tags');
  return {
    extraBlocks: blocks.filter((b) => !OWNED_KEYS.has(b.key)),
    userTags: tagBlock ? listItems(tagBlock).filter((t) => !isGeneratedTag(t)) : [],
  };
}

// `carry` is optional: a CREATE has no prior note, and passing nothing must
// render exactly what this function rendered before (162 notes in the real
// library carry nothing extra -- rewriting them differently would produce a
// diff on every one of them for no reason).
function renderNote(entry, notesZone, carry) {
  const title = noteTitle(entry);
  const description = fitDescription(entry.description);
  const zone = notesZone && notesZone.trim() ? notesZone : `\n\n${STUB}\n`;
  const frontmatter = [
    '---',
    `title: ${yamlString(entry.name)}`,
    'type: skill',
    `description: ${yamlString(description)}`,
    `herkunft: ${entry.herkunft}`,
    `ort: ${yamlString(entry.ort)}`,
    `plugin: ${yamlString(entry.plugin || '')}`,
    `status: ${entry.status}`,
    `created: ${entry.created}`,
    `last_modified: ${entry.lastModified}`,
    // The user's own keys sit between the generated scalars and `tags`, which
    // is where this vault's own convention puts custom fields -- tags always
    // last. Carried as LINES, never re-serialised: a value this code does not
    // understand survives unexamined.
    ...(carry && carry.extraBlocks ? carry.extraBlocks.flatMap((b) => b.lines) : []),
    'tags:',
    '  - Claude/ClaudeCode',
    `  - Skill/${entry.herkunft}`,
    ...(carry && carry.userTags ? carry.userTags.map((t) => `  - ${t}`) : []),
    '---',
  ].join('\n');
  const body = [
    '',
    `# ${title}`,
    '',
    `**Zweck:** ${description}`,
    '',
    `**Ort:** \`${entry.ort}\``,
    '',
    `**Herkunft:** ${entry.herkunft} · **Status:** ${entry.status}`,
    '',
    NOTES_HEADING,
  ].join('\n');
  return `${frontmatter}\n${body}${zone}`;
}

// Grouped index, revised 2026-08-26 on the Founder's instruction after he read
// the flat version. Primary grouping is by origin, in this fixed order; a
// group with no rows is omitted entirely rather than rendered empty.
const ORIGIN_GROUPS = ['Eigene', 'Externe', 'Andere'];

// Secondary grouping is by the status VALUES themselves -- never a two-way
// aktiv/inaktiv split. `referenz` means "vorhanden, aber nicht kuratiert",
// explicitly not a value judgement (see the legend below); collapsing it
// into "inaktiv" would misfile notes that are simply uncurated, not dead.
const STATUS_GROUPS = ['aktiv', 'referenz', 'entfallen'];

const TABLE_HEADER = ['| # | Skill | Herkunft | Status | Plugin/Ort-Hinweis |',
                       '|---|-------|----------|--------|----------------------|'];

const LEGEND = [
  '## Legende',
  '',
  '| Spalte | Bedeutung |',
  '|---|---|',
  '| # | Laufende Nummer, durchgehend ueber alle Gruppen |',
  '| Skill | Wikilink auf die Notiz des Skills |',
  '| Herkunft | Woher der Skill kommt: eigen, extern, org-plugin, projekt-lokal, kandidat |',
  '| Status | aktiv = von uns gepflegt · referenz = vorhanden, nicht kuratiert · entfallen = existiert nicht mehr |',
  '| Plugin/Ort-Hinweis | Das Plugin samt Version, oder das Repo, aus dem der Skill stammt |',
];

function originGroupOf(herkunft) {
  if (herkunft === 'eigen') return 'Eigene';
  if (herkunft === 'extern') return 'Externe';
  return 'Andere';
}

// Known statuses first, in the fixed order; any other value encountered is
// still rendered -- never silently dropped -- appended after, alphabetically
// for determinism.
function statusOrder(statusesPresent) {
  const known = STATUS_GROUPS.filter((s) => statusesPresent.has(s));
  const rest = [...statusesPresent].filter((s) => !STATUS_GROUPS.includes(s)).sort();
  return [...known, ...rest];
}

function sortByTitle(rows) {
  return [...rows].sort((a, b) =>
    a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
}

function renderIndex(rows) {
  const byOrigin = { Eigene: [], Externe: [], Andere: [] };
  for (const r of rows) byOrigin[originGroupOf(r.herkunft)].push(r);

  let counter = 0;
  const out = [];
  for (const origin of ORIGIN_GROUPS) {
    const originRows = byOrigin[origin];
    if (originRows.length === 0) continue;
    out.push(`## ${origin}`, '');
    const statuses = new Set(originRows.map((r) => r.status));
    for (const status of statusOrder(statuses)) {
      const subRows = sortByTitle(originRows.filter((r) => r.status === status));
      if (subRows.length === 0) continue;
      out.push(`### ${status}`, '', ...TABLE_HEADER);
      for (const r of subRows) {
        counter += 1;
        out.push(`| ${counter} | [[${r.title}]] | ${r.herkunft} | ${r.status} | ${r.hint || ''} |`);
      }
      out.push('');
    }
  }
  out.push(...LEGEND);
  return out.join('\n');
}

module.exports = {
  renderNote, renderIndex, noteTitle, fitDescription, DESCRIPTION_CAP,
  carryFrontmatter, OWNED_KEYS, isGeneratedTag,
};
