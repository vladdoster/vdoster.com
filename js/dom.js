// The only place text enters the DOM, and the only place navigation happens.
//
// Commands return data, never DOM and never HTML:
//   Line    = { cls?, segs: Segment[] }
//   Segment = { text, cls?, action?: { type: 'cd'|'cat'|'open'|'follow', arg, key? }, label? }
//
// `action.arg` is a VFS PATH, never a URL. The click handler resolves it
// against the frozen TREE and reads the URL from there, so a URL cannot be
// injected through the DOM even if dataset.arg were fully attacker-controlled.
// That is structural rather than escaping, so it survives careless edits.
//
// Hard rule: nothing under js/ may assign an HTML string to the DOM or build
// code at runtime. The README carries the grep that enforces it; keeping the
// banned tokens out of comments is what keeps that grep a real signal.

export function el(tag, cls, textContent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (textContent != null) node.textContent = textContent;   // the single text sink
  return node;
}

export function renderLine(line) {
  const row = el('div', 'line' + (line.cls ? ' ' + line.cls : ''));
  for (const seg of line.segs ?? []) {
    if (!seg.action) {
      row.append(el('span', seg.cls, seg.text));
      continue;
    }
    const button = el('button', 'seg' + (seg.cls ? ' ' + seg.cls : ''), seg.text);
    button.type = 'button';
    button.dataset.act = seg.action.type;
    button.dataset.arg = seg.action.arg;
    // second key for "a link embedded inside a text file": arg is still the
    // file's VFS path, key names which of that node's declared links to follow
    if (seg.action.key != null) button.dataset.key = seg.action.key;
    if (seg.label) button.setAttribute('aria-label', seg.label);
    row.append(button);
  }
  return row;
}

export function renderLines(lines) {
  const frag = document.createDocumentFragment();
  for (const line of lines) frag.append(renderLine(line));
  return frag;
}

// Plain-text line helpers, so commands stay readable.
export const line  = (...segs) => ({ segs: segs.filter(Boolean) });
export const t     = (text, cls) => ({ text, cls });
export const blank = () => ({ segs: [{ text: '' }] });
export const err   = (text) => ({ cls: 'err', segs: [{ text }] });

const ALLOWED = new Set(['https:', 'http:', 'mailto:']);

export function openUrl(url, newTab) {
  let parsed;
  try { parsed = new URL(url, location.href); } catch { return false; }
  if (!ALLOWED.has(parsed.protocol)) return false;

  // mailto: through window.open leaves an orphaned blank tab behind
  if (parsed.protocol === 'mailto:') { location.href = parsed.href; return true; }

  // window.open does NOT imply noopener the way <a target="_blank"> does
  if (newTab) window.open(parsed.href, '_blank', 'noopener,noreferrer');
  else location.assign(parsed.href);
  return true;
}
