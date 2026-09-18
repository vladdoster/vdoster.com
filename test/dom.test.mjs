import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// dom.js uses location.assign() for pages and sets location.href for mailto,
// so the shim has to observe both to prove neither path leaks.
let assigned, opened, hrefValue = 'https://vdoster.com/';
globalThis.location = {
  get href() { return hrefValue; },
  set href(u) { hrefValue = u; assigned = u; },
  assign(u) { assigned = u; },
};
globalThis.window = { open(u, target, features) { opened = { u, target, features }; } };

const { openUrl } = await import('../js/dom.js');

beforeEach(() => { assigned = undefined; opened = undefined; hrefValue = 'https://vdoster.com/'; });

test('openUrl navigates for the schemes the site actually uses', () => {
  assert.equal(openUrl('https://github.com/vladdoster/', false), true);
  assert.equal(assigned, 'https://github.com/vladdoster/');
  assert.equal(openUrl('http://rap-diablo.vdoster.com', false), true);
});

test('openUrl refuses every other scheme', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x']) {
    assert.equal(openUrl(bad, false), false, `${bad} must not navigate`);
    assert.equal(assigned, undefined);
    assert.equal(opened, undefined);
  }
});

test('a new tab always carries noopener, which window.open does not imply', () => {
  openUrl('https://github.com/vladdoster/', true);
  assert.equal(opened.target, '_blank');
  assert.match(opened.features, /noopener/);
  assert.match(opened.features, /noreferrer/);
});

test('mailto goes through location, not a new tab that would be left blank', () => {
  assert.equal(openUrl('mailto:mvdoster@gmail.com', true), true);
  assert.equal(opened, undefined, 'mailto must not open a tab');
  assert.match(assigned, /^mailto:/);
});
