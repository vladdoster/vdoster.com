import { test, beforeEach } from 'bun:test';
import assert from 'node:assert/strict';

// `theme` is the only command that touches the document, and only to write a
// validated custom property. Everything else is pure.
globalThis.document = { documentElement: { style: {
  values: {},
  setProperty(k, v) { this.values[k] = v; },
  removeProperty(k) { delete this.values[k]; },
} } };

const { COMMANDS, lookup } = await import('../js/commands.js');

const text = (lines) => (lines ?? []).map(l => (l.segs ?? []).map(s => s.text).join('')).join('\n');
let ctx;
beforeEach(() => {
  ctx = {
    cwd: [], narrow: false, opened: null,
    setCwd(s) { this.cwd = s; }, print() {}, clear() {}, closeWindow() {},
    openUrl(u) { this.opened = u; return true; },
  };
  document.documentElement.style.values = {};
});

test('ls lists every entry and renders links as symlinks', () => {
  const rows = text(COMMANDS.ls.run(ctx, [])).split('\n');
  assert.equal(rows.length, 5);
  assert.match(text(COMMANDS.ls.run(ctx, [])), /lrwxrwxrwx\s+github\s+-> https:\/\/github\.com\/vladdoster\//);
});

test('ls drops to names only when the window is narrow', () => {
  ctx.narrow = true;
  const out = text(COMMANDS.ls.run(ctx, []));
  assert.ok(!out.includes('lrwxrwxrwx'), 'mode column must not survive the narrow layout');
  assert.match(out, /github@/, 'a symlink still needs to look like one');
});

test('cd into a link fails like a shell, and says what to do instead', () => {
  const out = text(COMMANDS.cd.run(ctx, ['github']));
  assert.match(out, /Not a directory/);
  assert.match(out, /open github/);
});

test('cd with no argument goes home and prints nothing', () => {
  ctx.cwd = ['somewhere'];
  assert.equal(COMMANDS.cd.run(ctx, []), null);
  assert.deepEqual(ctx.cwd, []);
});

test('cd reports a missing path', () => {
  assert.match(text(COMMANDS.cd.run(ctx, ['nope'])), /No such file or directory/);
});

test('cat prints a body, reads a link like readlink, and refuses a directory', async () => {
  assert.match(text(await COMMANDS.cat.run(ctx, ['contact.txt'])), /mvdoster@gmail\.com/);
  assert.match(text(await COMMANDS.cat.run(ctx, ['github'])), /github -> https:\/\/github\.com\/vladdoster\//);
  assert.match(text(await COMMANDS.cat.run(ctx, ['.'])), /Is a directory/);
  assert.match(text(await COMMANDS.cat.run(ctx, [])), /missing operand/);
});

test('a trailing slash does not defeat a file lookup', async () => {
  assert.match(text(await COMMANDS.cat.run(ctx, ['contact.txt/'])), /mvdoster/);
});

test('open follows a link and refuses a directory', () => {
  COMMANDS.open.run(ctx, ['github']);
  assert.equal(ctx.opened, 'https://github.com/vladdoster/');
  assert.match(text(COMMANDS.open.run(ctx, ['.'])), /Is a directory/);
});

test('tree draws branches and counts what it drew', () => {
  const out = text(COMMANDS.tree.run(ctx, []));
  assert.ok(out.includes('├─ ') && out.includes('└─ '));
  assert.match(out, /0 directories, 5 files/);
  assert.ok(!/├─ github[\s\S]*├─ /.test(out.split('github')[1] ?? ''), 'links are leaves');
});

test('find matches, reports a miss, and echoes the term as literal text', () => {
  assert.match(text(COMMANDS.find.run(ctx, ['key'])), /keybase\.txt/);
  assert.match(text(COMMANDS.find.run(ctx, ['zzz'])), /no matches/);
  assert.match(text(COMMANDS.find.run(ctx, [])), /missing search term/);
  // find is the main path that echoes visitor input back into the page
  const payload = '<img src=x onerror=alert(1)>';
  assert.ok(text(COMMANDS.find.run(ctx, [payload])).includes(payload));
});

test('pwd and whoami', () => {
  assert.equal(text(COMMANDS.pwd.run(ctx, [])), '~');
  assert.equal(text(COMMANDS.whoami.run(ctx, [])), 'vlad');
});

test('help lists every command', () => {
  const out = text(COMMANDS.help.run(ctx, []));
  for (const name of Object.keys(COMMANDS)) assert.ok(out.includes(name), `help omits ${name}`);
});

test('theme accepts a name or a hex code', () => {
  COMMANDS.theme.run(ctx, ['mint']);
  assert.equal(document.documentElement.style.values['--c-text'], '#59fda0');
  COMMANDS.theme.run(ctx, ['#ff0080']);
  assert.equal(document.documentElement.style.values['--c-text'], '#ff0080');
});

test('theme rejects anything it cannot validate, including prototype keys', () => {
  for (const bad of ['nonsense', '#zzz', '#12345', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    document.documentElement.style.values = {};
    const out = text(COMMANDS.theme.run(ctx, [bad]));
    assert.equal(document.documentElement.style.values['--c-text'], undefined,
      `theme ${bad} must not reach setProperty`);
    assert.match(out, /unknown colour/);
  }
});

test('lookup resolves aliases and refuses prototype keys', () => {
  assert.equal(lookup('close'), COMMANDS.exit);
  assert.equal(lookup('ll'), COMMANDS.ls);
  assert.equal(lookup('definitelynot'), null);
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.equal(lookup(key), null, `lookup must not reach Object.prototype via ${key}`);
  }
});

test('hidden commands still work but stay out of help', () => {
  assert.match(text(lookup('sudo').run(ctx, [])), /sudoers/);
  assert.match(text(lookup('dd').run(ctx, [])), /records in/);
  for (const name of ['sudo', 'dd', 'poweroff', 'uname', 'echo']) {
    assert.ok(!(name in COMMANDS), `${name} should not be listed`);
  }
});

test('echo is the XSS canary and must stay literal', () => {
  const payload = ['<img', 'src=x', 'onerror=alert(1)>'];
  assert.equal(text(lookup('echo').run(ctx, payload)), '<img src=x onerror=alert(1)>');
});
