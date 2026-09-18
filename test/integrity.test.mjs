import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(root + p, 'utf8');
const html = read('index.html');
const jsFiles = readdirSync(root + 'js').filter(f => f.endsWith('.js'));

// Output is built from createElement + textContent only, because find, cat and
// the unknown-command message all echo visitor input back into the page.
test('no HTML-string or code-construction sinks anywhere in js/', () => {
  const banned = /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/;
  for (const f of jsFiles) {
    const hit = read(`js/${f}`).split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => banned.test(line));
    assert.deepEqual(hit, [], `js/${f} introduces an HTML sink: ${JSON.stringify(hit)}`);
  }
});

// chrome.js, main.js and analytics.js touch window/matchMedia at module scope,
// so they cannot simply be imported here. Transpiling is enough to prove they
// parse, which is what catches a syntax error before it ships.
test('every module parses, including the ones that need a DOM', () => {
  const transpiler = new Bun.Transpiler({ loader: 'js' });
  for (const f of jsFiles) {
    assert.doesNotThrow(() => transpiler.transformSync(read(`js/${f}`)), `js/${f} does not parse`);
  }
});

// The CSP pins the one inline script by hash so script-src needs no
// 'unsafe-inline'. Editing the script without recomputing the hash silently
// stops it running, which would leave the fallback nav visible forever.
test('the CSP hash matches the inline script it pins', () => {
  const inline = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(inline, 'expected exactly one inline <script>');
  const digest = createHash('sha256').update(inline[1], 'utf8').digest('base64');
  assert.ok(html.includes(`'sha256-${digest}'`),
    `CSP is missing sha256-${digest} for the current inline script`);
});

test("CSP does not weaken script-src back to 'unsafe-inline'", () => {
  const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';
  const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src')) ?? '';
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), 'script-src must stay hash-pinned');
  assert.ok(csp.includes("base-uri 'none'"));
});

test('the document head has what a phone needs', () => {
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /name="viewport"[^>]*width=device-width/i);
  // maximum-scale / user-scalable=no is a WCAG 1.4.4 failure
  assert.ok(!/maximum-scale|user-scalable\s*=\s*no/i.test(html));
});

test('every local file the page references exists on disk', () => {
  const refs = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map(m => m[1].replace(/^\.\//, ''));
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    assert.ok(existsSync(root + ref), `index.html references ${ref}, which is missing`);
  }
});

test('the audio file that used to 404 on every load is gone for good', () => {
  for (const f of ['index.html', 'index.css', ...jsFiles.map(f => `js/${f}`)]) {
    assert.ok(!/sounds\/|typing\.mp3/.test(read(f)), `${f} still references the removed audio`);
  }
});

test('every url() in the stylesheet resolves to a file on disk', () => {
  const css = read('index.css');
  const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m => m[1]);
  assert.ok(urls.length > 0);
  for (const u of urls) {
    if (/^(?:[a-z]+:|\/\/|data:)/i.test(u)) continue;   // nothing external is expected
    assert.ok(existsSync(root + u), `index.css references ${u}, which is missing`);
  }
});

// Self-hosted so the CSP can keep font-src 'self'. SIL OFL 1.1 requires the
// licence to travel with the font.
test('the webfont is a real woff2 and ships its licence', () => {
  const font = root + 'assets/fonts/ServerMono-Regular.woff2';
  assert.ok(existsSync(font), 'the Server Mono file is missing');
  assert.equal(readFileSync(font).subarray(0, 4).toString('latin1'), 'wOF2',
    'not a woff2 file');
  const licence = root + 'assets/fonts/LICENSE.md';
  assert.ok(existsSync(licence), 'OFL 1.1 requires the licence alongside the font');
  assert.match(readFileSync(licence, 'utf8'), /SIL OPEN FONT LICENSE/i);
});

test('the font is declared and actually reached for', () => {
  const css = read('index.css');
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*"Server Mono"/);
  assert.match(css, /--mono:\s*"Server Mono"/, 'the face must lead the stack or it is never used');
  // no third-party font origin crept in
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|@import/i.test(css));
});

// Deploy guards. GitHub Pages serves this repo root directly, so losing any of
// these breaks the live site rather than a build.
test('the files the deploy depends on are still here', () => {
  assert.equal(read('CNAME').trim(), 'vdoster.com', 'a wrong CNAME takes the domain down');
  assert.ok(existsSync(root + '.nojekyll'), 'Jekyll would drop underscore-prefixed paths');
  assert.ok(existsSync(root + 'assets/bg.png'));
  assert.ok(existsSync(root + 'assets/favicon.ico'));
});

// Keybase re-fetches https://vdoster.com/keybase.txt to verify vlad_doster.
// Moving or reflowing it breaks the proof, publicly, on the Keybase profile.
test('the keybase proof is intact at the repo root', () => {
  const proof = read('keybase.txt');
  assert.match(proof, /keybase\.io\/vlad_doster/);
  assert.match(proof, /I am an admin of https:\/\/vdoster\.com/);
  assert.match(proof, /which yields the signature:/);
  // the signature binds to this exact hostname and scheme
  assert.match(proof, /"hostname":\s*"vdoster\.com"/);
  assert.match(proof, /"protocol":\s*"https:"/);
});

test('the fallback nav still carries real anchors for crawlers and no-JS', () => {
  const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '';
  const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 5, `fallback nav has only ${hrefs.length} links`);
  assert.ok(hrefs.some(h => h.includes('github.com/vladdoster')));
  assert.ok(hrefs.some(h => h.startsWith('mailto:')));
});
