'use strict';
// apply-cli.test.js -- Task 10: the `apply` branch of main(), its flags, and
// the exit-code mapping. Every scenario below drives main() end-to-end
// (argv in, exit code + stdout/stderr out) rather than calling applyPlan
// directly (that is already covered by apply.test.js), because the thing
// this task adds IS the argv-to-applyPlan wiring, and a real inventory
// requires a real $HOME -- so each test points $HOME at a throwaway
// directory with a controlled `.claude/skills/` rather than touching the
// developer's own machine.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../scripts/cli.js');
const { renderNote } = require('../scripts/render.js');

function fakeHome({ skillCount = 1 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-home-'));
  const skillsDir = path.join(home, '.claude', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  for (let i = 0; i < skillCount; i++) {
    const dir = path.join(skillsDir, `skill-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\ndescription: skill ${i}\n---\n# skill ${i}\n`);
  }
  return home;
}

function vaultWith({ libraryPath = 'Library/Skill Library', createLibraryDir = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-vault-'));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, '_vault-autopilot-config.md'),
    ['```yaml', 'skill_library:', `  library_path: "${libraryPath}"`, '```'].join('\n'));
  if (createLibraryDir) fs.mkdirSync(path.join(vault, libraryPath), { recursive: true });
  return vault;
}

function withHome(home, fn) {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try { return fn(); } finally { process.env.HOME = prev; }
}

function captureIO(fn) {
  let out = '';
  let err = '';
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => { out += chunk; return true; };
  process.stderr.write = (chunk) => { err += chunk; return true; };
  let code;
  try {
    code = fn();
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  return { code, out, err };
}

test('apply without --write previews and writes nothing', () => {
  const home = fakeHome({ skillCount: 3 });
  const vault = vaultWith();
  const libDir = path.join(vault, 'Library', 'Skill Library');
  const before = fs.readdirSync(libDir);
  const { code, out } = withHome(home, () => captureIO(() => main(['apply', vault])));
  assert.strictEqual(code, 0);
  assert.match(out, /planned:\s+3/);
  assert.deepStrictEqual(fs.readdirSync(libDir), before);
});

test('apply preview surfaces the library-path warning when the path is unconfigured', () => {
  const home = fakeHome({ skillCount: 1 });
  const vault = vaultWith({ libraryPath: '' });
  const { code, out } = withHome(home, () => captureIO(() => main(['apply', vault])));
  assert.strictEqual(code, 0);
  assert.match(out, /warning: no library_path is configured/i);
});

test('apply --write on a fresh vault creates notes and exits 0', () => {
  const home = fakeHome({ skillCount: 2 });
  const vault = vaultWith();
  const { code, out } = withHome(home, () => captureIO(() => main(['apply', vault, '--write'])));
  assert.strictEqual(code, 0);
  assert.match(out, /created:\s+2/);
  const created = fs.readdirSync(path.join(vault, 'Library', 'Skill Library', 'Eigene Skills'));
  assert.strictEqual(created.length, 2);
});

test('apply --write with an empty inventory refuses: exit 1, nothing on stdout', () => {
  const home = fakeHome({ skillCount: 0 });
  const vault = vaultWith();
  const { code, err, out } = withHome(home, () => captureIO(() => main(['apply', vault, '--write'])));
  assert.strictEqual(code, 1);
  assert.match(err, /empty inventory/i);
  assert.strictEqual(out, '');
});

test('apply --write over the mass-change ceiling refuses: exit 1', () => {
  const home = fakeHome({ skillCount: 5 });
  const vault = vaultWith();
  const { code, err } = withHome(home, () => captureIO(() => main(['apply', vault, '--write', '--max', '2'])));
  assert.strictEqual(code, 1);
  assert.match(err, /Mass-change guard/);
});

test('apply --write is unblocked by a raised --max', () => {
  const home = fakeHome({ skillCount: 5 });
  const vault = vaultWith();
  const { code } = withHome(home, () => captureIO(() => main(['apply', vault, '--write', '--max', '10'])));
  assert.strictEqual(code, 0);
});

test('apply --write over the retire cap refuses: exit 1', () => {
  const home = fakeHome({ skillCount: 1 });
  const vault = vaultWith();
  const libDir = path.join(vault, 'Library', 'Skill Library', 'Eigene Skills');
  fs.mkdirSync(libDir, { recursive: true });
  for (let i = 0; i < 20; i++) {
    const body = renderNote({
      name: `gone${i}`, suffix: '', description: 'd', herkunft: 'eigen', ort: `/gone${i}`,
      plugin: '', status: 'aktiv', created: '2026-01-01 00:00', lastModified: '2026-01-01 00:00',
    }, '');
    fs.writeFileSync(path.join(libDir, `Skill – gone${i}.md`), body);
  }
  const { code, err } = withHome(home, () => captureIO(() => main(['apply', vault, '--write'])));
  assert.strictEqual(code, 1);
  assert.match(err, /Retire guard/);
});

test('apply --write is unblocked by a raised --retire-max', () => {
  const home = fakeHome({ skillCount: 1 });
  const vault = vaultWith();
  const libDir = path.join(vault, 'Library', 'Skill Library', 'Eigene Skills');
  fs.mkdirSync(libDir, { recursive: true });
  for (let i = 0; i < 20; i++) {
    const body = renderNote({
      name: `gone${i}`, suffix: '', description: 'd', herkunft: 'eigen', ort: `/gone${i}`,
      plugin: '', status: 'aktiv', created: '2026-01-01 00:00', lastModified: '2026-01-01 00:00',
    }, '');
    fs.writeFileSync(path.join(libDir, `Skill – gone${i}.md`), body);
  }
  const { code } = withHome(home, () => captureIO(() => main(['apply', vault, '--write', '--retire-max', '25'])));
  assert.strictEqual(code, 0);
});

test('apply --write with an unconfigured library_path refuses: exit 2', () => {
  const home = fakeHome({ skillCount: 1 });
  const vault = vaultWith({ libraryPath: '' });
  const { code, err } = withHome(home, () => captureIO(() => main(['apply', vault, '--write'])));
  assert.strictEqual(code, 2);
  assert.match(err, /no library_path is configured/i);
});

test('apply --write with a missing library directory refuses: exit 2', () => {
  const home = fakeHome({ skillCount: 1 });
  const vault = vaultWith({ createLibraryDir: false });
  const { code, err } = withHome(home, () => captureIO(() => main(['apply', vault, '--write'])));
  assert.strictEqual(code, 2);
  assert.match(err, /does not exist/);
});

test('apply --max with a missing value is a usage error: exit 2', () => {
  const { code, err } = captureIO(() => main(['apply', '/tmp/whatever', '--max']));
  assert.strictEqual(code, 2);
  assert.match(err, /--max requires a numeric value/);
});

test('apply --retire-max with a non-numeric value is a usage error: exit 2', () => {
  const { code, err } = captureIO(() => main(['apply', '/tmp/whatever', '--retire-max', 'abc']));
  assert.strictEqual(code, 2);
  assert.match(err, /--retire-max requires a numeric value/);
});

test('apply with an unknown flag is a usage error: exit 2', () => {
  const { code, err } = captureIO(() => main(['apply', '/tmp/whatever', '--bogus']));
  assert.strictEqual(code, 2);
  assert.match(err, /unknown flag: --bogus/);
});

test('apply with no vault is a usage error: exit 2', () => {
  const { code, err } = captureIO(() => main(['apply']));
  assert.strictEqual(code, 2);
  assert.match(err, /usage:/);
});

test('an unknown command is still a usage error: exit 2', () => {
  const { code, err } = captureIO(() => main(['bogus', '/tmp/whatever']));
  assert.strictEqual(code, 2);
  assert.match(err, /unknown command: bogus/);
});

// FIX (round 1, Finding 2): applyPlan used to merge create-kind and
// relocate-kind writes into one `written` array, so `apply --write` printed
// every relocated note as a "create:" line and inflated `created:` by
// exactly the relocated count. A mixed batch (one genuinely new skill, one
// existing note whose skill moved) must report both counts separately.
test('apply --write reports created and relocated as separate counts for a mixed batch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sls-home-mixed-'));
  const skillsDir = path.join(home, '.claude', 'skills');
  for (const name of ['alpha', 'beta']) {
    fs.mkdirSync(path.join(skillsDir, name), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, name, 'SKILL.md'), `---\ndescription: ${name}\n---\n`);
  }

  const vault = vaultWith();
  const libDir = path.join(vault, 'Library', 'Skill Library', 'Eigene Skills');
  fs.mkdirSync(libDir, { recursive: true });
  // 'alpha' already has a note, but at a STALE ort -- the inventory now
  // points it at .../skills/alpha, so this must be RELOCATED, not created.
  // 'beta' has no note yet, so it must be CREATED. Two different buckets,
  // one apply run.
  const staleBody = renderNote({
    name: 'alpha', suffix: '', description: 'd', herkunft: 'eigen', ort: '/somewhere/else',
    plugin: '', status: 'aktiv', created: '2026-01-01 00:00', lastModified: '2026-01-01 00:00',
  }, '');
  fs.writeFileSync(path.join(libDir, 'Skill – alpha.md'), staleBody);

  const { code, out } = withHome(home, () => captureIO(() => main(['apply', vault, '--write'])));
  assert.strictEqual(code, 0);
  assert.match(out, /created:\s+1/);
  assert.match(out, /relocated:\s+1/);
  assert.doesNotMatch(out, /created:\s+2/, 'a relocation must not be counted as a creation');
});
