# [vdoster.com](https://vdoster.com) source code

An interactive terminal. Type `ls`.

Static site, no build step — GitHub Pages serves the repo root as-is.

## Layout

| Path | |
| --- | --- |
| `index.html` | document head, the window markup, and the static `<nav>` fallback |
| `index.css` | window chrome and palette (custom properties live in `:root`) |
| `js/vfs.js` | **the site's content** — edit this to add or change a link |
| `js/dom.js` | the only place visitor text enters the DOM, and the only place navigation happens |
| `js/commands.js` | command registry and implementations |
| `js/terminal.js` | input loop, tokenizer, history, tab completion |
| `js/chrome.js` | drag, traffic lights, touch key bar, clock |
| `js/analytics.js` | the gtag bootstrap — out of line so the CSP needs no `unsafe-inline` |
| `js/main.js` | boot and the global backtick/Escape handler |

## Developing

```sh
python3 -m http.server 8000
```

A server is required: `file://` blocks both ES modules and `fetch`, so opening
`index.html` directly shows a blank page.

## Tests

```sh
npm test          # or: node --test test/*.test.mjs
```

No dependencies and no build step. The suite is plain `node:test`, and GitHub
Actions runs it on every push and pull request (`.github/workflows/test.yml`).

| File | Covers |
| --- | --- |
| `test/vfs.test.mjs` | path resolution, and every rejection `assertVfs` makes |
| `test/commands.test.mjs` | the command behaviour matrix and its error paths |
| `test/terminal.test.mjs` | the tokenizer and the completion offset |
| `test/dom.test.mjs` | which URL schemes may navigate, and `noopener` |
| `test/integrity.test.mjs` | static guards against the regressions below |

The integrity guards are the ones worth knowing about, because each protects
something that fails silently in production rather than loudly in a build:

- **No HTML sinks in `js/`.** Output is built from `document.createElement` and
  `textContent` only, because `find`, `cat` and the unknown-command message all
  echo visitor input back into the page. `echo` is kept as a live canary:
  `echo <img src=x onerror=alert(1)>` must render as literal text.
- **The CSP hash still matches its inline script.** Editing the script without
  recomputing the hash stops it running, and the page is left showing the
  fallback nav forever.
- **`CNAME`, `.nojekyll`, the assets and the keybase proof are intact**, and
  every local path `index.html` references exists on disk.

## Don't break

- `keybase.txt` must stay byte-identical **at the repo root**. The Keybase proof
  for `vlad_doster` is verified by fetching `https://vdoster.com/keybase.txt`.
- `CNAME` must not be deleted, or the domain stops resolving.

## Author

Written by [Vlad Doster](https://vdoster.com).

## License

Copyright © 2020 Vlad Doster. Released under the MIT license — see [LICENSE](LICENSE).
