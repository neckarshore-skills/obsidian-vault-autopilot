'use strict';
// config.js — the skill_library section of the vault's _vault-autopilot-config.md.
//
// The plugin already has one config surface (references/config-spec.md). This
// skill uses it rather than adding a second. A missing or malformed config is a
// valid state and yields defaults; it never throws, because a broken config file
// must not be able to stop a read-only scan.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULTS = { libraryPath: '', retiredSubfolder: 'Entfallen', sourceRoots: [] };

function expandHome(p) {
  const s = String(p).trim();
  return s.startsWith('~') ? path.join(os.homedir(), s.slice(1)) : s;
}

// A deliberately small YAML reader: this section is two scalars and a list, and
// pulling in a parser for that would be the larger risk.
function readSection(text) {
  const fence = String(text).match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!fence) return {};
  const lines = fence[1].split('\n');
  const start = lines.findIndex((l) => /^skill_library: *$/.test(l));
  if (start === -1) return {};
  const out = { sourceRoots: [] };
  let inList = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const scalar = line.match(/^ {2}([a-z_]+): *(.+)$/);
    const item = line.match(/^ {4}- *(.+)$/);
    if (scalar) {
      inList = false;
      const value = scalar[2].trim().replace(/^["']|["']$/g, '');
      if (scalar[1] === 'library_path') out.libraryPath = value;
      if (scalar[1] === 'retired_subfolder') out.retiredSubfolder = value;
    } else if (/^ {2}source_roots(_extend)?: *$/.test(line)) {
      inList = true;
    } else if (item && inList) {
      out.sourceRoots.push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

function loadConfig(vaultPath) {
  let section = {};
  try {
    section = readSection(fs.readFileSync(
      path.join(vaultPath, '_vault-autopilot-config.md'), 'utf8'));
  } catch { /* no config is a valid state */ }
  return {
    libraryPath: section.libraryPath || DEFAULTS.libraryPath,
    retiredSubfolder: section.retiredSubfolder || DEFAULTS.retiredSubfolder,
    sourceRoots: (section.sourceRoots || []).map(expandHome),
  };
}

module.exports = { loadConfig, readSection, expandHome, DEFAULTS };
