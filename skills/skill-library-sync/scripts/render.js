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

function renderIndex(rows) {
  const sorted = [...rows].sort((a, b) =>
    a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }));
  const header = ['| # | Skill | Herkunft | Status | Plugin/Ort-Hinweis |',
                  '|---|-------|----------|--------|----------------------|'];
  const body = sorted.map((r, i) =>
    `| ${i + 1} | [[${r.title}]] | ${r.herkunft} | ${r.status} | ${r.hint || ''} |`);
  return [...header, ...body].join('\n');
}

module.exports = { renderNote, renderIndex, noteTitle, fitDescription, DESCRIPTION_CAP };
