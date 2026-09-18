# [vdoster.com](https://vdoster.com) source code

An interactive terminal. Type `ls`.

Static site, no build step — GitHub Pages serves the repo root as-is.

## Layout

| Path | |
| --- | --- |
| `index.html` | document head, the window markup, and the static `<nav>` fallback |
| `index.css` | window chrome and palette (custom properties live in `:root`) |
| `js/vfs.js` | **the site's content** — edit this to add or change a link |
| `js/dom.js` | the only place text enters the DOM, and the only place navigation happens |
| `js/commands.js` | command registry and implementations |
| `js/terminal.js` | input loop, tokenizer, history, tab completion |
| `js/chrome.js` | drag, traffic lights, touch key bar, clock |
| `js/main.js` | boot and the global backtick/Escape handler |

## Developing

```sh
python3 -m http.server 8000
```

A server is required: `file://` blocks both ES modules and `fetch`, so opening
`index.html` directly shows a blank page.

Before committing, this must print nothing:

```sh
grep -rn "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write\|eval(\|new Function" js/
```

Output is built from `document.createElement` + `textContent` only, because
`find`, `cat` and the unknown-command message all echo visitor input back into
the page. `echo` is kept as a live canary — `echo <img src=x onerror=alert(1)>`
must render as literal text.

## Don't break

- `keybase.txt` must stay byte-identical **at the repo root**. The Keybase proof
  for `vlad_doster` is verified by fetching `https://vdoster.com/keybase.txt`.
- `CNAME` must not be deleted, or the domain stops resolving.

## Author

Written by [Vlad Doster](https://vdoster.com).

## License

Copyright © 2020 Vlad Doster. Released under the MIT license — see [LICENSE](LICENSE).
