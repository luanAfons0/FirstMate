/**
 * The chrome strip: the program's own, above the content view.
 *
 * It holds one control — see the plugin list — and the name of what is open.
 * It is one file with no assets of its own, as the Index Page is.
 *
 * The Host does not serve this page, and must never serve it. Every Plugin
 * Page shares an origin with the Index Page, so a strip the Host served would
 * be a strip a Plugin Page could read and rewrite (ADR-0011).
 *
 * The strip asks the program for something by trying to go somewhere. The
 * library's message channel aborts the program on Windows when the page that
 * uses it is not served over HTTP, and the strip is deliberately not served at
 * all. A link the program refuses to follow carries the same one message, needs
 * nothing injected, and cannot take the program down.
 */

/** The scheme the strip asks with. The program answers every address in it. */
export const SCHEME = 'firstmate:';

/** The address the control asks for. The program refuses it and acts instead. */
export const PLUGIN_LIST = `${SCHEME}plugin-list`;

/** What the strip says is open when the content view is on the Index Page. */
export const THE_PLUGIN_LIST = 'the Plugin list';

/**
 * The strip, naming what is open.
 *
 * It is rewritten rather than scripted when what is open changes: the page is
 * small, and re-reading it costs less than reaching into it would.
 */
export function stripPage(open: string, fault?: string): string {
  const onTheList = open === THE_PLUGIN_LIST;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>FirstMate</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; height: 100vh; display: flex; align-items: center; gap: 12px;
    padding: 0 14px; background: #17181a; color: #d6d8dc; overflow: hidden;
    font: 13px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  }
  a {
    color: inherit; text-decoration: none; border: 1px solid #34363b;
    border-radius: 6px; padding: 6px 10px; white-space: nowrap;
  }
  a:hover { background: #24262a; border-color: #4a4d54; }
  a[aria-disabled='true'] { opacity: .4; pointer-events: none; }
  b { font-weight: 600; }
  span { color: #8b8f97; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  span.fault { color: #e8a0a0; }
</style>
<a href="${PLUGIN_LIST}"${onTheList ? " aria-disabled='true'" : ''}>see the plugin list</a>
${fault === undefined ? name(open, onTheList) : `<span class="fault">${escaped(fault)}</span>`}
</html>`;
}

/** What is open, in the strip's own words. */
function name(open: string, onTheList: boolean): string {
  return `<span>${onTheList ? 'FirstMate' : `<b>${escaped(open)}</b>`}</span>`;
}

/** A Plugin Name is not the program's to trust, so it is written as text. */
function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
