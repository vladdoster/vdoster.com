import './analytics.js';
import { TREE, assertVfs, deepFreeze } from './vfs.js';
import { createTerminal } from './terminal.js';
import { createChrome } from './chrome.js';

const $ = (id) => document.getElementById(id);

// If anything below throws, put the page back into its no-JS state so the
// static <nav> of real links reappears. A blank backdrop is the worst
// possible failure for a site whose entire content is links.
function bail(e) {
  document.documentElement.classList.add('no-js');
  document.documentElement.classList.remove('closed');
  // chrome.js takes the fallback links out of the tab order while the terminal
  // is open, and removing `closed` also hides the reopen pill. Without this the
  // fallback comes back visible but with nothing on the page focusable - the
  // opposite of what it is for, in the one situation it exists for.
  for (const a of document.querySelectorAll('.fallback a')) a.removeAttribute('tabindex');
  console.error('terminal failed to start:', e);
}

let booted = false;

try {
  deepFreeze(assertVfs(TREE));

  const win      = $('term');
  const body     = $('term-body');
  const out      = $('term-out');
  const input    = $('term-input');
  const form     = $('term-form');
  const titlebar = $('term-titlebar');
  const reopen   = $('term-reopen');

  let chrome;    // chrome needs terminal, terminal needs chrome.close
  const terminal = createTerminal({
    out, body, input, form,
    promptEl: $('term-prompt'),
    closeWindow: () => chrome && chrome.close(),
  });

  chrome = createChrome({
    win, titlebar, input, reopen, terminal,
    keybar:    $('term-keybar'),
    legendEl:  $('term-legend'),
    ctxEl:     $('term-ctx'),
  });

  // `ls -l` style rows wrap into mush on a narrow window; below 480px the
  // listing drops to names only.
  const contentWidth = () => {
    const cs = getComputedStyle(body);
    return body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const syncNarrow = () => terminal.setNarrow(contentWidth() < 480);
  new ResizeObserver(syncNarrow).observe(body);
  // Measured synchronously as well: a ResizeObserver delivers its first
  // callback after the current task, so the boot `ls` below - the first and
  // often only thing a visitor sees - would render wide on every phone.
  syncNarrow();

  terminal.boot();
  chrome.open();

  // Backtick opens; Escape closes. The isEditable guard is on the BACKTICK
  // branch only, which is deliberate:
  //   - terminal closed -> focus is the reopen pill (a BUTTON) -> backtick opens
  //   - terminal open   -> focus is the input -> backtick types a literal `
  //   - Escape is checked in the else, so it closes regardless of focus
  // Do not "fix" this by guarding Escape too, or backtick becomes untypable.
  const isEditable = (el) =>
    !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

  addEventListener('keydown', (e) => {
    // e.repeat: holding the key would otherwise strobe the window
    // isComposing / 229: a CJK visitor would toggle mid-IME-composition
    // 'Dead': on German and Nordic layouts backtick is a dead key used to
    //         compose accents, and must not toggle anything
    if (e.repeat || e.isComposing || e.keyCode === 229 || e.key === 'Dead') return;

    // match e.code as well as e.key: AltGr layouts report ctrlKey && altKey,
    // which the modifier guard would otherwise reject
    const isBacktick = e.code === 'Backquote' || e.key === '`';
    if (isBacktick && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditable(e.target)) {
      e.preventDefault();
      chrome.toggle();
    } else if (e.key === 'Escape' && chrome.isOpen()) {
      chrome.close();
    }
  });

  addEventListener('pageshow', (e) => { if (e.persisted) terminal.scrollToEnd(); });

  booted = true;
  // Tells the inline script in index.html that the module really ran, so it
  // does not put the page back into its no-JS state on load.
  document.documentElement.dataset.booted = '1';
} catch (e) {
  bail(e);
}

// Only a failure BEFORE the terminal came up should fall back. "#term-out is
// empty" is not that test - `clear` empties it too, so any later unrelated
// error (an extension, a ResizeObserver loop report) used to tear down a
// perfectly healthy terminal mid-session.
addEventListener('error', (e) => { if (!booted) bail(e.error || e.message); });
