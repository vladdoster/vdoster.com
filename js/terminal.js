import { TREE, USER, HOST, pathOf, resolve, listDir } from './vfs.js';
import { el, renderLine, renderLines, line, t, blank, err, openUrl } from './dom.js';
import { COMMANDS, ALIASES, COLOR_NAMES, lookup } from './commands.js';

/* ---------- tokenizer --------------------------------------------------- */
// Quote-aware so `find "rap diablo"` works. Shared with tab completion, which
// needs the trailing empty token to know "the user is starting a new word".

const TOK = /"([^"]*)"|'([^']*)'|(\S+)/g;

export function tokenize(str, { keepTrailingEmpty = false } = {}) {
  const out = [];
  let m;
  TOK.lastIndex = 0;
  while ((m = TOK.exec(str))) out.push(m[1] ?? m[2] ?? m[3]);
  if (keepTrailingEmpty && /\s$/.test(str)) out.push('');
  return out;
}

/* ---------- history ----------------------------------------------------- */
// sessionStorage, not localStorage: history should survive a reload in the
// same tab, but a fresh visit should feel fresh.

function makeHistory() {
  let items = [];
  try { items = JSON.parse(sessionStorage.getItem('vd.hist') || '[]'); } catch { /* blocked */ }
  if (!Array.isArray(items)) items = [];

  let cursor = null;    // null = editing a fresh line
  let draft = '';

  return {
    all: () => items,
    push(str) {
      if (str.trim() && str !== items[items.length - 1]) items.push(str);
      if (items.length > 100) items.splice(0, items.length - 100);
      cursor = null; draft = '';
      try { sessionStorage.setItem('vd.hist', JSON.stringify(items)); } catch { /* blocked */ }
    },
    prev(current) {
      if (!items.length) return null;
      if (cursor === null) { draft = current; cursor = items.length; }
      if (cursor === 0) return items[0];
      return items[--cursor];
    },
    next() {
      if (cursor === null) return null;
      if (cursor >= items.length - 1) { cursor = null; return draft; }  // restores the draft
      return items[++cursor];
    },
  };
}

/* ---------- terminal ---------------------------------------------------- */

export function createTerminal({ out, body, input, form, promptEl, ctxEl, closeWindow }) {
  let cwd = [];
  let narrow = false;
  let busy = false;
  const history = makeHistory();

  const promptSegs = () => [
    { text: `[root@${HOST}]`, cls: 't-host' },
    { text: pathOf(cwd),      cls: 't-path' },
    { text: '$ ' },
  ];

  function drawPrompt() {
    promptEl.replaceChildren();
    for (const seg of promptSegs()) promptEl.append(el('span', seg.cls, seg.text));
    if (ctxEl) ctxEl.textContent = pathOf(cwd);
  }

  function atBottom() {
    return body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
  }

  function print(lines) {
    if (!lines || !lines.length) return;
    const stick = atBottom();
    // Only the newest block stays in the tab order; after five `ls` calls there
    // would otherwise be dozens of buttons ahead of the input.
    for (const b of out.querySelectorAll('button.seg')) b.tabIndex = -1;
    out.append(renderLines(lines));
    if (stick) body.scrollTop = body.scrollHeight;
  }

  function echoCommand(raw) {
    print([{ segs: [...promptSegs(), { text: raw }] }]);
  }

  const ctx = {
    get cwd() { return cwd.slice(); },
    get narrow() { return narrow; },
    setCwd(segs) { cwd = segs; drawPrompt(); },
    print,
    clear() { out.replaceChildren(); },
    closeWindow,
    openUrl,
  };

  async function submit(raw) {
    echoCommand(raw);
    history.push(raw);

    const toks = tokenize(raw);
    if (!toks.length) return;                       // people mash Enter

    const cmd = lookup(toks[0]);
    if (!cmd) {
      print([
        { cls: 'err', segs: [{ text: 'command not found: ' }, { text: toks[0] }] },
        { cls: 'dim', segs: [{ text: "type 'help' for the list" }] },
      ]);
      return;
    }

    busy = true;
    input.readOnly = true;
    try {
      const lines = await cmd.run(ctx, toks.slice(1));
      if (lines) print(lines);
    } catch (e) {
      print([err(`error: ${e && e.message ? e.message : String(e)}`)]);
    } finally {
      busy = false;
      input.readOnly = false;
      body.scrollTop = body.scrollHeight;
    }
  }

  /* ---------- tab completion -------------------------------------------- */

  function commandNames(prefix) {
    return [...Object.keys(COMMANDS), ...Object.keys(ALIASES)]
      .filter((n) => n.startsWith(prefix)).sort();
  }

  function argCandidates(cmdName, partial) {
    const spec = (COMMANDS[ALIASES[cmdName] ?? cmdName] ?? {}).args;
    if (spec === 'color')   return COLOR_NAMES.filter((c) => c.startsWith(partial));
    if (spec === 'command') return commandNames(partial);
    if (spec !== 'path' && spec !== 'dir') return [];

    const cut  = partial.lastIndexOf('/');
    const base = cut < 0 ? '' : partial.slice(0, cut + 1);
    const leaf = cut < 0 ? partial : partial.slice(cut + 1);
    const here = resolve(cwd, base || '.');
    if (!here || here.node.kind !== 'dir') return [];

    return listDir(here.node)
      .filter(([n, v]) => n.startsWith(leaf) && (spec !== 'dir' || v.kind === 'dir'))
      .map(([n, v]) => base + n + (v.kind === 'dir' ? '/' : ''));
  }

  function longestCommonPrefix(xs) {
    let p = xs[0];
    for (let i = 1; i < xs.length; i++) {
      let k = 0;
      while (k < p.length && k < xs[i].length && p[k] === xs[i][k]) k++;
      p = p.slice(0, k);
      if (!p) break;
    }
    return p;
  }

  function complete() {
    const caret = input.selectionStart ?? input.value.length;
    if (caret !== input.value.length) return;          // only complete at end of line
    const head = input.value.slice(0, caret);
    const toks = tokenize(head, { keepTrailingEmpty: true });
    const partial = toks.length ? toks[toks.length - 1] : '';

    const cands = toks.length <= 1 ? commandNames(partial)
                                   : argCandidates(toks[0], partial);
    if (!cands.length) return;

    const apply = (replacement) => {
      const start = caret - partial.length;
      input.value = input.value.slice(0, start) + replacement + input.value.slice(caret);
      const pos = start + replacement.length;
      input.setSelectionRange(pos, pos);
    };

    if (cands.length === 1) {
      const only = cands[0];
      apply(only.endsWith('/') ? only : only + ' ');
      return;
    }
    const lcp = longestCommonPrefix(cands);
    if (lcp.length > partial.length) { apply(lcp); return; }
    print([{ segs: [...promptSegs(), { text: input.value }] },
           line(t(cands.join('   '), 't-dim'))]);
  }

  /* ---------- input ------------------------------------------------------ */

  form.addEventListener('submit', (e) => {
    e.preventDefault();                                // a form without this reloads the page
    if (busy) return;
    const raw = input.value;
    input.value = '';
    submit(raw);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      // Swallowing Tab on an empty input would be a keyboard trap, so an empty
      // line lets focus move on normally. Documented in the status legend.
      if (e.shiftKey || input.value === '') return;
      e.preventDefault();
      complete();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const v = history.prev(input.value);
      if (v != null) { input.value = v; queueMicrotask(() => input.setSelectionRange(v.length, v.length)); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const v = history.next();
      if (v != null) { input.value = v; queueMicrotask(() => input.setSelectionRange(v.length, v.length)); }
      return;
    }
    if (e.key === 'c' && e.ctrlKey) {
      // Never hijack copy - this terminal's whole content is URLs people want
      if (!window.getSelection().isCollapsed) return;
      e.preventDefault();
      print([{ segs: [...promptSegs(), { text: input.value + '^C' }] }]);
      input.value = '';
      return;
    }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); ctx.clear(); return; }
    if (e.key === 'u' && e.ctrlKey) {
      e.preventDefault();
      const caret = input.selectionStart ?? 0;
      input.value = input.value.slice(caret);
      input.setSelectionRange(0, 0);
    }
  });

  /* ---------- clicking output ------------------------------------------- */
  // arg is always a VFS path. The URL is read from the frozen TREE here, so
  // nothing navigable ever lives in the DOM.

  out.addEventListener('click', (e) => {
    const button = e.target.closest('button.seg');
    if (!button) return;
    const { act, arg, key } = button.dataset;
    const hit = resolve([], arg);
    if (!hit) return;

    if (act === 'cd')  { submit(`cd ${arg}`);  input.focus(); return; }
    if (act === 'cat') { submit(`cat ${arg}`); input.focus(); return; }
    if (act === 'open' && hit.node.kind === 'link') {
      openUrl(hit.node.url, e.metaKey || e.ctrlKey);
      return;
    }
    if (act === 'open' && hit.node.src) {
      openUrl(new URL(hit.node.src, import.meta.url).href, e.metaKey || e.ctrlKey);
      return;
    }
    if (act === 'follow' && hit.node.links && key in hit.node.links) {
      openUrl(hit.node.links[key], e.metaKey || e.ctrlKey);
    }
  });

  // Click-to-focus, but never at the end of a drag-select or output becomes
  // impossible to copy.
  body.addEventListener('mouseup', () => {
    if (window.getSelection().isCollapsed && !input.readOnly) input.focus();
  });

  /* ---------- boot ------------------------------------------------------- */

  function boot() {
    drawPrompt();
    print([
      line(t(`${HOST} — v2`, 't-host')),
      line(t("type 'help' for commands · tab completes · ↑ for history", 't-dim')),
      blank(),
    ]);
    // One synchronous ls, so the site's content is on screen for a visitor who
    // would never think to type a command. Not an animation - the prompt is
    // usable on the same frame.
    submit('ls');
  }

  return {
    boot,
    submit,
    focus: () => input.focus({ preventScroll: true }),
    setNarrow: (v) => { narrow = v; },
    scrollToEnd: () => { body.scrollTop = body.scrollHeight; },
  };
}
