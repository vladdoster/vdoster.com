import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TREE, USER, HOST, pathOf, resolve, listDir, assertVfs, deepFreeze }
  from '../js/vfs.js';

const dir = (children) => ({ kind: 'dir', children });

test('the shipped tree validates and freezes', () => {
  assert.doesNotThrow(() => assertVfs(TREE));
  deepFreeze(TREE);
  assert.ok(Object.isFrozen(TREE));
});

test('assertVfs rejects a link scheme it cannot vouch for', () => {
  assert.throws(() => assertVfs(dir({ x: { kind: 'link', url: 'javascript:alert(1)' } })), /unsafe/);
  assert.throws(() => assertVfs(dir({ x: { kind: 'link', url: 'data:text/html,hi' } })), /unsafe/);
  // http:// is allowed only when the node declares it on purpose
  assert.throws(() => assertVfs(dir({ x: { kind: 'link', url: 'http://plain.example' } })), /unsafe/);
  assert.doesNotThrow(() =>
    assertVfs(dir({ x: { kind: 'link', url: 'http://plain.example', insecure: true } })));
});

test('assertVfs rejects a text node that is both or neither', () => {
  assert.throws(() => assertVfs(dir({ f: { kind: 'text' } })), /exactly one/);
  assert.throws(() => assertVfs(dir({ f: { kind: 'text', body: 'a', src: 'b' } })), /exactly one/);
});

test('assertVfs keeps src same-origin', () => {
  // `open` navigates to src, and CSP does not police top-level navigation
  assert.throws(() => assertVfs(dir({ f: { kind: 'text', src: '//evil.example/x' } })), /relative path/);
  assert.throws(() => assertVfs(dir({ f: { kind: 'text', src: 'https://evil.example/x' } })), /relative path/);
  assert.doesNotThrow(() => assertVfs(dir({ f: { kind: 'text', src: '../keybase.txt' } })));
});

test('assertVfs holds embedded file links to the same scheme rule', () => {
  const node = { kind: 'text', body: 'x', links: { x: 'javascript:alert(1)' } };
  assert.throws(() => assertVfs(dir({ f: node })), /unsafe/);
  const plain = { kind: 'text', body: 'x', links: { x: 'http://plain.example' } };
  assert.throws(() => assertVfs(dir({ f: plain })), /unsafe/);
});

test('assertVfs rejects names that break path resolution or quoting', () => {
  assert.throws(() => assertVfs(dir({ 'a/b': { kind: 'text', body: 'x' } })), /in name/);
  assert.throws(() => assertVfs(dir({ 'a"b': { kind: 'text', body: 'x' } })), /in name/);
});

test('assertVfs rejects an unknown kind', () => {
  assert.throws(() => assertVfs(dir({ x: { kind: 'socket' } })), /unknown kind/);
});

test('resolve walks the tree', () => {
  assert.equal(resolve([], '~').segs.length, 0);
  assert.equal(resolve([], 'contact.txt').node.kind, 'text');
  assert.equal(resolve([], 'github').node.kind, 'link');
  assert.equal(resolve([], './contact.txt').node.kind, 'text');
  assert.equal(resolve([], 'nope.txt'), null);
});

test('.. at the root stays at the root instead of going undefined', () => {
  assert.equal(resolve([], '..').segs.length, 0);
  assert.equal(resolve([], '../../..').segs.length, 0);
});

test('lookup is case-insensitive but records the canonical name', () => {
  const hit = resolve([], 'GitHub');
  assert.equal(hit.node.kind, 'link');
  assert.equal(hit.segs[0], 'github', 'display must not echo the typed casing');
});

test('listDir puts directories first, then sorts', () => {
  const names = listDir(TREE).map(([n]) => n);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('identity and path rendering', () => {
  assert.equal(USER, 'vlad');
  assert.equal(HOST, 'vdoster.com');
  assert.equal(pathOf([]), '~');
  assert.equal(pathOf(['a', 'b']), '~/a/b');
});
