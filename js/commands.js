import { TREE, USER, HOST, pathOf, resolve, listDir, srcUrl } from './vfs.js';
import { line, t, blank, err } from './dom.js';

// Every table a visitor's raw word is looked up in. A null prototype is what
// keeps `theme constructor` and `help __proto__` from resolving to
// Object.prototype members and sailing past the "unknown" guard below.
const table = (o) => Object.assign(Object.create(null), o);

const MODE = { dir: 'drwxr-xr-x', text: '-rw-r--r--', link: 'lrwxrwxrwx' };
const CLS  = { dir: 't-path',    text: null,         link: 't-link'    };
const ACT  = { dir: 'cd',        text: 'cat',        link: 'open'      };

const nameSeg = (name, node, segs) => ({
  text: name + (node.kind === 'dir' ? '/' : ''),
  cls: CLS[node.kind],
  action: { type: ACT[node.kind], arg: pathOf(segs) },
  label: node.kind === 'link'
    ? `Open ${name} (${node.desc ?? 'external link'}) in this tab`
    : node.kind === 'dir' ? `Change to directory ${name}` : `Print ${name}`,
});

// One resolver for every command that takes a path, so the error wording
// and the case-insensitive fallback stay identical everywhere.
function target(ctx, cmd, spec) {
  const cleaned = String(spec).replace(/\/+$/, '') || '/';
  const hit = resolve(ctx.cwd, cleaned);
  if (!hit) return { error: err(`${cmd}: ${spec}: No such file or directory`) };
  return hit;
}

/* ---------- ls ---------------------------------------------------------- */

function cmdLs(ctx, args) {
  const spec = args[0] ?? '.';
  const hit = target(ctx, 'ls', spec);
  if (hit.error) return [hit.error];

  if (hit.node.kind !== 'dir') {
    // ls of a single non-directory lists just that entry, like real ls
    const name = hit.segs[hit.segs.length - 1];
    return [row(name, hit.node, hit.segs, ctx, name.length)];
  }

  const entries = listDir(hit.node);
  if (!entries.length) return [line(t('  (empty)', 't-dim'))];
  const width = Math.max(...entries.map(([n, v]) => n.length + (v.kind === 'dir' ? 1 : 0)));
  return entries.map(([name, node]) => row(name, node, [...hit.segs, name], ctx, width));
}

function row(name, node, segs, ctx, width) {
  const seg = nameSeg(name, node, segs);
  if (ctx.narrow) {
    return node.kind === 'link'
      ? { segs: [seg, { text: '@', cls: 't-dim' }] }
      : { segs: [seg] };
  }
  const pad = ' '.repeat(Math.max(1, width - seg.text.length + 2));
  const head = { text: MODE[node.kind] + '  ', cls: 't-dim' };
  if (node.kind === 'link') {
    return { segs: [head, seg, { text: pad + '-> ' }, { text: node.url, cls: 't-dim' }] };
  }
  const desc = node.desc ? { text: pad + node.desc, cls: 't-dim' } : null;
  return { segs: [head, seg, desc].filter(Boolean) };
}

/* ---------- cd ---------------------------------------------------------- */

function cmdCd(ctx, args) {
  if (!args.length) { ctx.setCwd([]); return null; }          // bare cd -> home
  const hit = target(ctx, 'cd', args[0]);
  if (hit.error) return [hit.error];
  if (hit.node.kind !== 'dir') {
    const name = hit.segs[hit.segs.length - 1] ?? args[0];
    const out = [err(`cd: ${args[0]}: Not a directory`)];
    if (hit.node.kind === 'link') {
      out.push({ cls: 'dim', segs: [
        { text: 'hint: it is a symlink off-site - try ' },
        { text: `open ${name}`, cls: 't-host', action: { type: 'open', arg: pathOf(hit.segs) },
          label: `Open ${name}` },
      ]});
    }
    return out;
  }
  ctx.setCwd(hit.segs);
  return null;
}

/* ---------- cat --------------------------------------------------------- */

async function cmdCat(ctx, args) {
  if (!args.length) return [err('cat: missing operand')];
  const hit = target(ctx, 'cat', args[0]);
  if (hit.error) return [hit.error];
  const { node, segs } = hit;
  const name = segs[segs.length - 1] ?? args[0];

  if (node.kind === 'dir') return [err(`cat: ${args[0]}: Is a directory`)];

  // cat on a symlink prints where it points, like readlink. A visitor who
  // types `cat github` obviously wants to go there, so the target is clickable.
  if (node.kind === 'link') {
    return [
      { segs: [
        { text: name, cls: 't-link' },
        { text: ' -> ' },
        { text: node.url, cls: 't-path', action: { type: 'open', arg: pathOf(segs) },
          label: `Open ${name} in this tab` },
      ]},
      node.desc ? line(t(node.desc, 't-dim')) : blank(),
    ];
  }

  let body = node.body;
  if (body == null) {
    // Bounded: the caller holds the prompt readOnly for the whole await, so a
    // request that never settles would wedge the terminal with no way out.
    let res;
    try {
      res = await fetch(srcUrl(node), { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    } catch {
      return [err(`cat: ${name}: fetch failed`)];
    }
    if (!res.ok) return [err(`cat: ${name}: fetch failed (${res.status})`)];
    body = (await res.text()).replace(/\n+$/, '');
  }
  return body.split('\n').map((text) => bodyLine(text, node.links, segs));
}

// Turns a declared substring of a file body into a clickable segment without
// ever putting a URL in the DOM: arg stays the file's path, key names the link.
function bodyLine(text, links, segs) {
  if (links) {
    for (const needle of Object.keys(links)) {
      const i = text.indexOf(needle);
      if (i < 0) continue;
      return { segs: [
        { text: text.slice(0, i) },
        { text: needle, cls: 't-link',
          action: { type: 'follow', arg: pathOf(segs), key: needle },
          label: `Open ${needle}` },
        { text: text.slice(i + needle.length) },
      ]};
    }
  }
  return line(t(text));
}

/* ---------- open -------------------------------------------------------- */

function cmdOpen(ctx, args) {
  if (!args.length) return [err('open: missing operand')];
  const hit = target(ctx, 'open', args[0]);
  if (hit.error) return [hit.error];
  const { node } = hit;

  if (node.kind === 'dir')  return [err(`open: ${args[0]}: Is a directory`)];
  if (node.kind === 'link') { ctx.openUrl(node.url, false); return null; }
  if (node.src)             { ctx.openUrl(srcUrl(node), false); return null; }
  return [err(`open: ${args[0]}: not a page - try cat ${args[0]}`)];
}

/* ---------- tree -------------------------------------------------------- */

function cmdTree(ctx, args) {
  const hit = target(ctx, 'tree', args[0] ?? '.');
  if (hit.error) return [hit.error];
  if (hit.node.kind !== 'dir') return [err(`tree: ${args[0]}: Not a directory`)];

  const out = [line(t(pathOf(hit.segs), 't-path'))];
  walk(hit.node, hit.segs, '', out);
  const n = count(hit.node);
  out.push(blank());
  out.push(line(t(`${n.dirs} director${n.dirs === 1 ? 'y' : 'ies'}, ${n.files} file${n.files === 1 ? '' : 's'}`, 't-dim')));
  return out;
}

function walk(node, segs, prefix, out) {
  const entries = listDir(node);
  entries.forEach(([name, child], i) => {
    const last = i === entries.length - 1;
    const here = [...segs, name];
    const seg = nameSeg(name, child, here);
    const row = { segs: [{ text: prefix + (last ? '└─ ' : '├─ '), cls: 't-dim' }, seg] };
    if (child.kind === 'link') row.segs.push({ text: ' -> ' + child.url, cls: 't-dim' });
    out.push(row);
    // links are leaves: they point off-site, there is nothing to recurse into
    if (child.kind === 'dir') walk(child, here, prefix + (last ? '   ' : '│  '), out);
  });
}

function count(node, acc = { dirs: 0, files: 0 }) {
  for (const [, child] of listDir(node)) {
    if (child.kind === 'dir') { acc.dirs++; count(child, acc); } else acc.files++;
  }
  return acc;
}

/* ---------- find -------------------------------------------------------- */

function cmdFind(ctx, args) {
  const term = (args[0] ?? '').slice(0, 64);
  if (!term) return [err('find: missing search term')];
  const needle = term.toLowerCase();
  const hits = [];

  (function scan(node, segs) {
    for (const [name, child] of listDir(node)) {
      const here = [...segs, name];
      const at = name.toLowerCase().indexOf(needle);
      if (at >= 0) hits.push({ name, node: child, segs: here, at });
      if (child.kind === 'dir') scan(child, here);
    }
  })(TREE, []);

  if (!hits.length) return [line(t(`find: no matches for `), t(term, 't-err'))];

  // The match is highlighted by splitting the name into three TEXT segments.
  // Never by wrapping it in a tag string - this is the main echo path.
  return hits.map(({ name, node, segs, at }) => {
    const seg = nameSeg(name, node, segs);
    return { segs: [
      { text: pathOf(segs.slice(0, -1)) + '/', cls: 't-dim' },
      { text: name.slice(0, at), cls: seg.cls },
      { text: name.slice(at, at + term.length), cls: 't-hit' },
      { text: name.slice(at + term.length), cls: seg.cls },
      { text: '   ' },
      { text: 'open', cls: 't-dim', action: seg.action, label: seg.label },
    ]};
  });
}

/* ---------- small ones -------------------------------------------------- */

const cmdPwd    = (ctx) => [line(t(pathOf(ctx.cwd), 't-path'))];
const cmdWhoami = ()    => [line(t(USER))];
const cmdClear  = (ctx) => { ctx.clear(); return null; };
const cmdExit   = (ctx) => { ctx.closeWindow(); return null; };

function cmdHelp(ctx, args) {
  if (args.length) {
    const name = ALIASES[args[0]] ?? args[0];
    const cmd = COMMANDS[name];
    if (!cmd) return [err(`help: no such command: ${args[0]}`)];
    return [line(t('  ' + name.padEnd(14), 't-host'), t(cmd.desc))];
  }
  const out = [line(t('commands', 't-dim'))];
  for (const cmd of Object.values(COMMANDS)) {
    out.push(line(t('  ' + cmd.usage.padEnd(14), 't-host'), t(cmd.desc)));
  }
  out.push(blank());
  out.push(line(t('tab completes · ↑↓ history · click anything highlighted', 't-dim')));
  return out;
}

/* ---------- theme ------------------------------------------------------- */

const COLORS = table({
  mint:   '#59fda0', green:  '#ACFA33', cyan:   '#32c9e3', blue:   '#7d9ff0',
  cream:  '#FFF5E3', amber:  '#f5be4f', red:    '#ff6b6b', violet: '#cacbf9',
  white:  '#ffffff',
});
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function cmdTheme(ctx, args) {
  if (!args.length) {
    document.documentElement.style.removeProperty('--c-text');
    return [line(t('theme reset', 't-dim'))];
  }
  const raw = args[0].toLowerCase();
  const hex = COLORS[raw] ?? (HEX.test(raw) ? raw : null);
  if (!hex) {
    return [
      err(`theme: ${args[0]}: unknown colour`),
      line(t(`try a name (${Object.keys(COLORS).join(', ')}) or a hex code like #ff0080`, 't-dim')),
    ];
  }
  // validated, never interpolated - the regex above is the whole guard
  document.documentElement.style.setProperty('--c-text', hex);
  return [line(t('theme set to ' + hex, 't-dim'))];
}

/* ---------- hidden: the old site's personality, kept as easter eggs ------ */

const pad2 = (n) => String(n).padStart(2, '0');

// Transplanted from the original index.js, integer quirks and all.
function ddOutput() {
  const sizeGb   = 64 << Math.floor(Math.random() * 4);
  const duration = (sizeGb >> 6) * 500;
  const blockSize = 4;
  const records = (sizeGb << 10) / blockSize;
  const trueDuration = duration / 1000 + Math.random();
  const throughput = sizeGb / trueDuration;
  let bytes = (sizeGb << 20) / 1000;
  bytes <<= 10;
  return [
    `${records}+0 records in`,
    `${records}+0 records out`,
    `${bytes}000 bytes (${sizeGb} GB) copied, ${trueDuration.toFixed(5)} s, ${throughput.toFixed(1)} GB/s`,
  ].map((text) => line(t(text)));
}

const HIDDEN = table({
  dd:       () => ddOutput(),
  sudo:     () => [err(`${USER} is not in the sudoers file. This incident will be reported.`)],
  uname:    () => [line(t(`${HOST} 6.1.0 #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux`))],
  date:     () => [line(t(new Date().toString()))],
  echo:     (ctx, args) => [line(t(args.join(' ')))],   // XSS canary - must render literally
  poweroff: (ctx) => {
    const now = new Date();
    const out = [
      blank(),
      line(t(`Broadcast message from [root@${HOST}]`)),
      line(t(`\t\t(/dev/pts/0) at ${pad2(now.getHours())}:${pad2(now.getMinutes())}...`)),
      blank(),
      line(t('The system is going down for halt NOW!')),
    ];
    setTimeout(() => ctx.closeWindow(), 900);
    return out;
  },
});

/* ---------- registry ---------------------------------------------------- */

export const COMMANDS = table({
  ls:     { usage: 'ls',            args: 'path', desc: 'list files in the current directory',   run: cmdLs },
  cd:     { usage: 'cd <dir>',      args: 'dir',  desc: 'change directory ( .. to go up, ~ for root )', run: cmdCd },
  cat:    { usage: 'cat <file>',    args: 'path', desc: "print a file's contents",               run: cmdCat },
  open:   { usage: 'open <file>',   args: 'path', desc: 'open a page in the browser',            run: cmdOpen },
  tree:   { usage: 'tree',          args: 'path', desc: 'show the directory tree',               run: cmdTree },
  find:   { usage: 'find <term>',   args: 'none', desc: 'search for files by name',              run: cmdFind },
  pwd:    { usage: 'pwd',           args: 'none', desc: 'print the working directory',           run: cmdPwd },
  whoami: { usage: 'whoami',        args: 'none', desc: 'print the current user',                run: cmdWhoami },
  theme:  { usage: 'theme [color]', args: 'color',desc: 'recolor the terminal (try a color!)',   run: cmdTheme },
  help:   { usage: 'help',          args: 'command', desc: 'this list',                          run: cmdHelp },
  clear:  { usage: 'clear',         args: 'none', desc: 'clear the screen',                      run: cmdClear },
  exit:   { usage: 'exit',          args: 'none', desc: 'close the terminal',                    run: cmdExit },
});

export const ALIASES = table({
  close: 'exit', quit: 'exit', '?': 'help', man: 'help',
  dir: 'ls', ll: 'ls', cls: 'clear', colour: 'theme', color: 'theme',
});

export const COLOR_NAMES = Object.keys(COLORS);

export function lookup(name) {
  const resolved = ALIASES[name] ?? name;
  return COMMANDS[resolved] ?? (HIDDEN[resolved] ? { run: HIDDEN[resolved], args: 'none' } : null);
}
