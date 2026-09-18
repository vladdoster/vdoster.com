// The gtag bootstrap lives here rather than inline in index.html, which is what
// lets the CSP carry script-src with no 'unsafe-inline'. gtag.js drains
// whatever is already in dataLayer when it loads, so order does not matter.
window.dataLayer = window.dataLayer || [];
window.gtag = function gtag() { window.dataLayer.push(arguments); };
window.gtag('js', new Date());
window.gtag('config', 'G-DY1J66LGP0');
