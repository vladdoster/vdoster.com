import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tokenize, lastTokenStart } from '../js/terminal.js';

test('tokenize splits on whitespace', () => {
  assert.deepEqual(tokenize('cat a b'), ['cat', 'a', 'b']);
  assert.deepEqual(tokenize('   '), []);
  assert.deepEqual(tokenize('ls   '), ['ls']);
});

test('tokenize honours quotes so a name with a space survives', () => {
  assert.deepEqual(tokenize('find "rap diablo"'), ['find', 'rap diablo']);
  assert.deepEqual(tokenize("find 'rap diablo'"), ['find', 'rap diablo']);
  assert.deepEqual(tokenize('cat "contact.txt"'), ['cat', 'contact.txt']);
});

test('tokenize keeps a trailing empty token only when asked', () => {
  assert.deepEqual(tokenize('cd '), ['cd']);
  assert.deepEqual(tokenize('cd ', { keepTrailingEmpty: true }), ['cd', '']);
  assert.deepEqual(tokenize('cd', { keepTrailingEmpty: true }), ['cd']);
});

// Completion splices over the raw token. Measuring it from the *unquoted*
// token length is off by the quote characters, which corrupts the line.
test('lastTokenStart measures the raw span, quotes included', () => {
  assert.equal(lastTokenStart('cat cont'), 4);
  assert.equal(lastTokenStart('cat "contact.txt"'), 4);
  assert.equal(lastTokenStart("cat 'contact.txt'"), 4);
  assert.equal(lastTokenStart('ls'), 0);
});

test('lastTokenStart puts the caret on a new word after a space', () => {
  assert.equal(lastTokenStart('cat '), 4);
  assert.equal(lastTokenStart(''), 0);
  assert.equal(lastTokenStart('cat "a b" '), 10);
});
