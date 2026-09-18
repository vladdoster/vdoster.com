// Window furniture: drag, traffic lights, open/close/minimize/expand, the
// touch key bar and the clock. One state object, one render() - five booleans
// mutated across six handlers is exactly where these combinations rot.

import { el } from './dom.js';

const coarse = matchMedia('(pointer: coarse)');
const fine   = matchMedia('(pointer: fine)');

export function createChrome({ win, titlebar, keybar, legendEl, ctxEl, input, reopen, terminal }) {
  const state = { open: true, minimized: false, expanded: false, tx: 0, ty: 0 };

  const fallbackLinks = [...document.querySelectorAll('.fallback a')];

  function render() {
    document.documentElement.classList.toggle('closed', !state.open);
    // The fallback <nav> is visually hidden while the terminal is open, and
    // focusing something invisible is disorienting. It stays in the accessibility
    // tree for screen readers and crawlers either way; it just leaves the tab
    // order until closing the window makes it visible again.
    for (const a of fallbackLinks) a.tabIndex = state.open ? -1 : 0;
    win.classList.toggle('minimized', state.minimized);
    win.classList.toggle('expanded', state.expanded);
    // see index.css: an auto height would stretch, not collapse
    win.style.height = state.minimized
      ? Math.ceil(titlebar.getBoundingClientRect().height) + 'px'
      : '';
    applyTransform();

    const min = titlebar.querySelector('.light.yellow');
    const zoom = titlebar.querySelector('.light.green');
    min.setAttribute('aria-pressed', String(state.minimized));
    min.setAttribute('aria-label', state.minimized ? 'Restore terminal' : 'Minimize terminal');
    zoom.setAttribute('aria-pressed', String(state.expanded));
    zoom.setAttribute('aria-label', state.expanded ? 'Restore terminal size' : 'Expand terminal');
  }

  /* ---------- drag ------------------------------------------------------- */

  let dragging = false;
  let origin = { x: 0, y: 0 };
  let downAt = { x: 0, y: 0 };
  let moved = false;

  const applyTransform = () => {
    // rounded, or 13px monospace renders blurry on subpixel offsets
    win.style.transform = `translate(${Math.round(state.tx)}px, ${Math.round(state.ty)}px)`;
  };

  // Apply the offset, measure what actually landed, then nudge it back inside.
  // Measuring first and deriving the untransformed origin does not work: the
  // rect still reflects the PREVIOUS transform while state.tx is already the
  // new value, so the two disagree and the clamp lets the window escape.
  function clamp() {
    applyTransform();
    const r = win.getBoundingClientRect();
    // A closed window is display:none (index.css), so it measures 0x0 at 0,0 -
    // which reads as "off the top-left corner" and nudges tx/ty by the margin.
    // resize, orientationchange, the ResizeObserver and every visualViewport
    // scroll all reach here while closed, so without this the window walks
    // down-right a little further every time it is reopened.
    if (!r.width && !r.height) return;
    const m = 8;
    let dx = 0, dy = 0;

    // A window larger than the viewport keeps its top-left corner reachable
    // rather than being centred out of reach.
    if (r.left < m) dx = m - r.left;
    else if (r.right > window.innerWidth - m) dx = Math.max(window.innerWidth - m - r.right, m - r.left);

    if (r.top < m) dy = m - r.top;
    else if (r.bottom > window.innerHeight - m) dy = Math.max(window.innerHeight - m - r.bottom, m - r.top);

    if (dx || dy) {
      state.tx += dx;
      state.ty += dy;
      applyTransform();
    }
  }

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    win.style.willChange = '';
    try { if (e && e.pointerId != null) titlebar.releasePointerCapture(e.pointerId); } catch { /* detached */ }
    clamp();
  }

  titlebar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || coarse.matches) return;          // no drag on touch
    if (e.target.closest('.lights')) return;               // the lights are not a handle
    dragging = true;
    moved = false;
    downAt = { x: e.clientX, y: e.clientY };
    origin = { x: e.clientX - state.tx, y: e.clientY - state.ty };
    win.style.willChange = 'transform';
    try { titlebar.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });

  titlebar.addEventListener('pointermove', (e) => {
    if (!dragging || !win.isConnected) return;
    // 4px threshold so a click on the titlebar is not swallowed as a drag
    if (!moved && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) <= 4) return;
    moved = true;
    state.tx = e.clientX - origin.x;
    state.ty = e.clientY - origin.y;
    // Clamped synchronously rather than inside requestAnimationFrame. The
    // window is a single composited element, so the layout read costs little,
    // and a deferred clamp leaves state.tx holding an off-screen value that
    // the next interaction applies all at once.
    clamp();
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    titlebar.addEventListener(type, endDrag);
  }
  addEventListener('blur', () => endDrag());

  // Keyboard alternative to dragging (WCAG 2.2 SC 2.5.7), which doubles as the
  // recovery path if the window ever ends up somewhere awkward.
  titlebar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 64 : 16;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      state.tx += moves[e.key][0];
      state.ty += moves[e.key][1];
      clamp();
    } else if (e.key === 'Home') {
      e.preventDefault();
      state.tx = state.ty = 0;
      render();
    }
  });

  addEventListener('resize', clamp);
  addEventListener('orientationchange', () => setTimeout(clamp, 250));
  // Expanding or minimizing near an edge grows the window off-screen unless
  // the clamp re-runs after the size change.
  new ResizeObserver(() => clamp()).observe(win);

  /* ---------- open / close / minimize / expand --------------------------- */

  function open() {
    state.open = true;
    if (state.minimized) state.minimized = false;
    render();
    clamp();
    // Auto-focusing on touch pops the soft keyboard over the window before
    // the visitor has seen anything.
    if (fine.matches) terminal.focus();
    else win.focus({ preventScroll: true });
    terminal.scrollToEnd();
  }

  function close() {
    endDrag();
    state.open = false;
    render();
    reopen.focus({ preventScroll: true });   // never strand focus on <body>
  }

  function toggle() { state.open ? close() : open(); }

  function minimize() {
    endDrag();
    // move focus off the input BEFORE it is display:none, or keystrokes vanish
    titlebar.focus({ preventScroll: true });
    const topBefore = win.getBoundingClientRect().top;
    state.minimized = !state.minimized;
    render();
    // margin:auto re-centres the smaller window, which slides the titlebar out
    // from under the cursor. Compensate so the bar stays where it was.
    state.ty += topBefore - win.getBoundingClientRect().top;
    // clamp() re-applies the transform, which is the only thing that changed.
    // A second render() here would rewrite every class and aria pair to the
    // values they already hold.
    clamp();
    if (!state.minimized && fine.matches) terminal.focus();
  }

  function zoom() {
    if (state.minimized) state.minimized = false;   // restore, then expand
    state.expanded = !state.expanded;
    render();
    clamp();
    if (fine.matches) terminal.focus();
  }

  titlebar.addEventListener('click', (e) => {
    const button = e.target.closest('.light');
    if (button) {
      const act = button.dataset.act;
      if (act === 'close') close();
      else if (act === 'minimize') minimize();
      else if (act === 'zoom') zoom();
      return;
    }
    if (state.minimized && !moved) minimize();       // click the bar to restore
  });

  reopen.addEventListener('click', open);

  /* ---------- touch key bar ---------------------------------------------- */

  const CHIPS = [
    ['tab', () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))],
    ['↑',   () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))],
    ['↓',   () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))],
    ['ls',    () => terminal.submit('ls')],
    ['help',  () => terminal.submit('help')],
    ['clear', () => terminal.submit('clear')],
    ['esc',   () => close()],
  ];

  function buildKeybar() {
    if (!coarse.matches) { keybar.hidden = true; return; }
    keybar.replaceChildren();
    for (const [label, action] of CHIPS) {
      const chip = el('button', null, label);   // dom.js owns the one text sink
      chip.type = 'button';
      // keep focus in the input so the soft keyboard does not close
      chip.addEventListener('pointerdown', (e) => e.preventDefault());
      chip.addEventListener('click', action);
      keybar.append(chip);
    }
    keybar.hidden = false;
  }

  /* ---------- status bar -------------------------------------------------- */

  function drawLegend() {
    legendEl.textContent = coarse.matches
      ? 'tap a name to open'
      : '` open · esc close · tab complete · ↑↓ history';
  }

  function drawClock() {
    const now = new Date();
    ctxEl.textContent = '⌚ ' + String(now.getHours()).padStart(2, '0') + ':' +
                        String(now.getMinutes()).padStart(2, '0');
  }
  drawClock();
  // Skipped while the tab is hidden or the window is closed - the statusbar is
  // not on screen either way, and visibilitychange below catches the return.
  setInterval(() => { if (!document.hidden && state.open) drawClock(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) drawClock(); });

  /* ---------- soft keyboard ----------------------------------------------- */
  // iOS shrinks the visual viewport rather than the layout viewport, so a
  // fixed window keeps its height and the prompt ends up under the keyboard.

  const vv = window.visualViewport;
  if (vv) {
    let lastH = -1;
    const fit = () => {
      // `scroll` fires at frame rate while panning a pinch-zoomed page, and a
      // scroll never changes the height. --vvh inherits from :root, so writing
      // it invalidates style for the whole document and resizes the window,
      // which wakes the ResizeObserver above for a second clamp.
      if (vv.height === lastH) return;
      lastH = vv.height;
      document.documentElement.style.setProperty('--vvh', vv.height + 'px');
      clamp();
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    fit();
  }
  input.addEventListener('focus', () => {
    if (coarse.matches) setTimeout(() => input.scrollIntoView({ block: 'nearest' }), 300);
  });

  for (const mq of [coarse, fine]) {
    mq.addEventListener('change', () => { buildKeybar(); drawLegend(); });
  }
  buildKeybar();
  drawLegend();
  render();

  return { open, close, toggle, isOpen: () => state.open, clamp };
}
