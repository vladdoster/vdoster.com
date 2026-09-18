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

// The canonical spelling of `name` under `parent`, or null. One scan, so the
// node a lookup returns and the name `resolve` pushes can never disagree.
function realName(parent, name) {
  if (parent.kind !== 'dir') return null;
  if (Object.prototype.hasOwnProperty.call(parent.children, name)) return name;
  // Silent case-insensitive fallback - rescues mobile autocapitalisation.
  const lower = name.toLowerCase();
  return Object.keys(parent.children).find((k) => k.toLowerCase() === lower) ?? null;
}

function child(node, name) {
  const real = realName(node, name);
  return real === null ? null : node.children[real];
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
    const real = realName(node, part);
    if (real === null) return null;
    // push the canonical name, not what was typed
    segs.push(real);
    node = node.children[real];
  }
  return { segs, node };
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
// Anything with a scheme, or scheme-relative. `src` must stay a same-origin
// relative path: `open` navigates to it, and CSP does not police navigation.
const OFF_ORIGIN      = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const schemeOk = (url, insecure) =>
  SAFE_SCHEME.test(url) || (insecure === true && INSECURE_SCHEME.test(url));

// `src` is resolved against this module's URL, so every consumer agrees on the
// base no matter which file does the resolving.
export const srcUrl = (node) => new URL(node.src, import.meta.url).href;

export function assertVfs(node = TREE, path = '~') {
  if (node.kind === 'dir') {
    for (const [name, value] of Object.entries(node.children)) {
      // `/` breaks path resolution; `"` breaks the quoting the click handler
      // uses to round-trip a name with a space back through the tokenizer.
      if (/[/"]/.test(name)) throw new Error(`vfs: '/' or '"' in name at ${path}/${name}`);
      assertVfs(value, `${path}/${name}`);
    }
  } else if (node.kind === 'link') {
    if (!schemeOk(node.url, node.insecure)) {
      throw new Error(`vfs: unsafe or undeclared scheme at ${path}: ${node.url}`);
    }
  } else if (node.kind === 'text') {
    if ((node.body == null) === (node.src == null)) {
      throw new Error(`vfs: need exactly one of body|src at ${path}`);
    }
    if (node.src != null && OFF_ORIGIN.test(node.src)) {
      throw new Error(`vfs: src must be a relative path at ${path}: ${node.src}`);
    }
    // `links` values are followed by the click handler exactly like a
    // kind:'link' url, so they answer to the same scheme rule.
    for (const [needle, url] of Object.entries(node.links ?? {})) {
      if (!schemeOk(url, node.insecure)) {
        throw new Error(`vfs: unsafe or undeclared scheme at ${path} link "${needle}": ${url}`);
      }
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
