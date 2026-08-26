'use strict';
// render.js — pure rendering of a Skill Library note and of the index.

const { NOTES_HEADING, STUB } = require('./library.js');

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

function renderNote(entry, notesZone) {
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
    'tags:',
    '  - Claude/ClaudeCode',
    `  - Skill/${entry.herkunft}`,
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

module.exports = { renderNote, renderIndex, noteTitle, fitDescription, DESCRIPTION_CAP };
