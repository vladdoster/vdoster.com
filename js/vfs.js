// The site's content. This is the only file you edit to change what the
// terminal shows. No DOM, no imports - just data and path resolution.

const dir  = (children)    => ({ kind: 'dir',  children });
const text = (o)           => ({ kind: 'text', ...o });   // exactly one of body | src
const link = (url, o = {}) => ({ kind: 'link', url, ...o });

export const USER = 'vlad';
export const HOST = 'vdoster.com';

export const TREE = dir({
  'contact.txt': text({
    desc: 'how to reach me',
    body: [
      'email      mvdoster@gmail.com',
      'github     vladdoster',
      'keybase    vlad_doster',
      'docker     vdoster',
    ].join('\n'),
    // substrings of the body that become clickable when cat'd
    links: { 'mvdoster@gmail.com': 'mailto:mvdoster@gmail.com' },
  }),

  // Fetched, never inlined. https://vdoster.com/keybase.txt must stay the
  // byte-identical source of truth or the Keybase proof for vlad_doster breaks.
  'keybase.txt': text({ desc: 'keybase identity proof', src: '../keybase.txt' }),

  // Pointed at the final destinations rather than the github./linkedin.
  // vanity CNAMEs, which cost two redirect hops each.
  github:   link('https://github.com/vladdoster/',           { desc: 'code' }),
  linkedin: link('https://www.linkedin.com/in/vlad-doster/', { desc: 'work history' }),
  // S3 website endpoints cannot serve TLS, so this one is http:// on purpose.
  music:    link('http://rap-diablo.vdoster.com',            { desc: 'beats', insecure: true }),
});

export const pathOf = (segs) => '~' + (segs.length ? '/' + segs.join('/') : '');

function child(node, name) {
  if (node.kind !== 'dir') return null;
  if (Object.prototype.hasOwnProperty.call(node.children, name)) return node.children[name];
  // Silent case-insensitive fallback - rescues mobile autocapitalisation.
  const lower = name.toLowerCase();
  const hit = Object.keys(node.children).find((k) => k.toLowerCase() === lower);
  return hit ? node.children[hit] : null;
}

// Returns { segs, node } or null. `segs` is canonical, so display always
// agrees with state even when the input used .. or a different case.
export function resolve(cwd, spec) {
  const raw = String(spec ?? '');
  if (raw === '' || raw === '~' || raw === '/') return { segs: [], node: TREE };

  const absolute = raw.startsWith('~/') || raw.startsWith('/');
  let segs = absolute ? [] : cwd.slice();
  let node = absolute ? TREE : nodeAt(cwd);
  if (!node) return null;

  for (const part of raw.replace(/^~?\/+/, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (segs.length) { segs.pop(); node = nodeAt(segs); }
      continue;                              // .. at root stays at root, silently
    }
    const next = child(node, part);
    if (!next) return null;
    // push the canonical name, not what was typed
    segs.push(realName(node, part));
    node = next;
  }
  return { segs, node };
}

function realName(parent, name) {
  if (parent.kind !== 'dir') return name;
  if (Object.prototype.hasOwnProperty.call(parent.children, name)) return name;
  const lower = name.toLowerCase();
  return Object.keys(parent.children).find((k) => k.toLowerCase() === lower) ?? name;
}

function nodeAt(segs) {
  let node = TREE;
  for (const s of segs) {
    const next = child(node, s);
    if (!next) return null;
    node = next;
  }
  return node;
}

export function listDir(node) {
  if (node.kind !== 'dir') return [];
  return Object.entries(node.children).sort(([a, x], [b, y]) => {
    const ad = x.kind === 'dir', bd = y.kind === 'dir';
    if (ad !== bd) return ad ? -1 : 1;              // directories first
    return a.localeCompare(b);
  });
}

// Walks every node once at boot. A violation is a developer error in this
// file, so it throws rather than degrading.
const SAFE_SCHEME     = /^(?:https:|mailto:)/i;
const INSECURE_SCHEME = /^http:/i;

export function assertVfs(node = TREE, path = '~') {
  if (node.kind === 'dir') {
    for (const [name, value] of Object.entries(node.children)) {
      if (name.includes('/')) throw new Error(`vfs: "/" in name at ${path}/${name}`);
      assertVfs(value, `${path}/${name}`);
    }
  } else if (node.kind === 'link') {
    const ok = SAFE_SCHEME.test(node.url) ||
               (node.insecure === true && INSECURE_SCHEME.test(node.url));
    if (!ok) throw new Error(`vfs: unsafe or undeclared scheme at ${path}: ${node.url}`);
  } else if (node.kind === 'text') {
    if ((node.body == null) === (node.src == null)) {
      throw new Error(`vfs: need exactly one of body|src at ${path}`);
    }
  } else {
    throw new Error(`vfs: unknown kind at ${path}`);
  }
  return node;
}

export function deepFreeze(node) {
  Object.freeze(node);
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  }
  return node;
}
