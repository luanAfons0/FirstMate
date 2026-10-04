/**
 * The chrome strip: the program's own, above the content view.
 *
 * It says where the window is as a breadcrumb — FirstMate, then the Plugin
 * that is open — and each part of it goes somewhere: FirstMate to the Plugin
 * list, the last part to the switcher, which lists every Plugin in the Plugin
 * Order. Beside it are open in browser and the gear that opens the Settings
 * View. It is one file with no assets of its own, as the Index Page is.
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
 *
 * While the switcher is open, the strip fills the window and the content view
 * is hidden, still loaded. Nothing is drawn over a Plugin Page, so nothing
 * depends on which of two views the library puts on top.
 */
import { ASK, openAsk, type Plugins } from './desktop-state.ts';
import { STATE_WORDS } from './index-page.ts';

/** Where the window is: the Index Page, one Plugin Page, or the Settings View. */
export type Here =
  | { readonly kind: 'list' }
  | { readonly kind: 'plugin'; readonly name: string }
  | { readonly kind: 'settings' };

/** Everything the strip says. It is written again whenever any of it changes. */
export type StripView = {
  readonly here: Here;
  /** Whether the switcher is open. */
  readonly switcher: boolean;
  /** Every Plugin the Host last named, in the Plugin Order. */
  readonly plugins: Plugins;
  /** What went wrong with the last thing asked for, until the next one. */
  readonly fault?: string;
};

/**
 * The strip, as one HTML document.
 *
 * It is rewritten rather than scripted when what it says changes: the page is
 * small, and re-reading it costs less than reaching into it would. The one
 * script it carries works the open switcher's keys, and asks for things the
 * same way a link does.
 */
export function stripPage(view: StripView): string {
  const atTheList = view.here.kind === 'list';
  const crumbs = `<a class="crumb"${atTheList ? " aria-disabled='true'" : ''} \
href="${ASK.pluginList}" title="See the Plugin list"><span aria-hidden="true">⌂</span> FirstMate</a>
<span class="sep" aria-hidden="true">›</span>
<a class="crumb last" href="${ASK.switcher}" aria-expanded="${view.switcher}" \
title="Switch Plugin">${hereWords(view.here)} <span aria-hidden="true">▾</span></a>`;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>FirstMate</title>
<style>
${styles()}
</style>
<nav class="bar">
${crumbs}
${view.fault === undefined ? '' : `<span class="fault">${escaped(view.fault)}</span>`}
<span class="gap"></span>
<a class="button" href="${ASK.openInBrowser}" title="Open what is shown here in the system browser">open in browser</a>
<a class="button gear" href="${ASK.settings}" title="Settings" aria-label="Settings" \
aria-pressed="${view.here.kind === 'settings'}">⚙</a>
</nav>
${view.switcher ? switcher(view) : ''}
</html>`;
}

/** The last part of the breadcrumb: what is open. */
function hereWords(here: Here): string {
  if (here.kind === 'plugin') return `<b>${escaped(here.name)}</b>`;
  return here.kind === 'settings' ? '<b>Settings</b>' : 'Plugins';
}

/**
 * The open switcher: every Plugin, or the one sentence that stands in for the
 * list. "The Host would not say" and "no Plugin is registered" are different
 * states, as they are in the Tray menu (#44).
 */
function switcher(view: StripView): string {
  const open = view.here.kind === 'plugin' ? view.here.name : undefined;
  const rows =
    view.plugins.kind === 'untold'
      ? '<p class="none">The Host would not say which Plugins there are.</p>'
      : view.plugins.plugins.length === 0
        ? '<p class="none">No Plugin is registered.</p>'
        : view.plugins.plugins
            .map((plugin) => {
              const dot = `<span class="dot ${plugin.state}" aria-hidden="true"></span>`;
              const words = `${dot}<span class="name">${escaped(plugin.name)}</span>\
<span class="state ${plugin.state}">${STATE_WORDS[plugin.state]}</span>`;
              // A Plugin with no Plugin Page has nowhere to go, so it is shown
              // and not offered, as in the Tray menu. A Stopped Plugin is still
              // offered: the Host serves its page whatever its server does.
              if (!plugin.hasPage) {
                return `<span class="row" aria-disabled="true">${words}<span class="tick"></span></span>`;
              }
              const here = plugin.name === open;
              return `<a class="row" href="${openAsk(plugin.name)}"${here ? ' aria-current="page"' : ''}>\
${words}<span class="tick" aria-hidden="true">${here ? '✓' : ''}</span></a>`;
            })
            .join('\n');
  return `<div class="backdrop"></div>
<div class="panel" role="menu" aria-label="Plugins">
${rows}
</div>
<script>
(() => {
  const close = () => { location.href = '${ASK.switcherClose}'; };
  const rows = Array.from(document.querySelectorAll('.panel a.row'));
  const start = document.querySelector('.panel a[aria-current]') || rows[0];
  if (start) start.focus();
  document.querySelector('.backdrop').addEventListener('click', close);
  addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement);
    const by = event.key === 'ArrowDown' ? 1 : -1;
    const next = at < 0 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1);
    if (rows[next]) rows[next].focus();
  });
  // A click anywhere else in the window takes the focus away from the strip.
  addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 120));
})();
</script>`;
}

function styles(): string {
  return `:root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: #17181a; }
  body {
    color: #d6d8dc; display: flex; flex-direction: column;
    font: 13px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  }
  .bar {
    flex: none; height: 44px; display: flex; align-items: center; gap: 6px;
    padding: 0 10px 0 8px; min-width: 0;
  }
  a { color: inherit; text-decoration: none; }
  a:focus-visible { outline: 2px solid #7aa2f7; outline-offset: 1px; }
  .crumb {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0;
    padding: 6px 8px; border-radius: 6px; white-space: nowrap; color: #b4b8bf;
  }
  .crumb.last { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; color: #d6d8dc; }
  .crumb b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .crumb:hover, .crumb[aria-expanded='true'] { background: #24262a; }
  .crumb[aria-disabled='true'] { pointer-events: none; }
  .sep { color: #5d6169; }
  .gap { flex: 1; }
  .fault {
    color: #e8a0a0; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; padding-left: 6px;
  }
  .button {
    border: 1px solid #34363b; border-radius: 6px; padding: 6px 10px; white-space: nowrap;
  }
  .button:hover { background: #24262a; border-color: #4a4d54; }
  .gear { font-size: 15px; line-height: 13px; padding: 6px 8px; }
  .gear[aria-pressed='true'] { background: #2b2e33; border-color: #4a4d54; }
  .backdrop { position: fixed; inset: 44px 0 0 0; background: #111214; }
  .panel {
    position: relative; margin: 2px 0 0 8px; width: min(360px, calc(100vw - 16px));
    max-height: calc(100vh - 58px); overflow-y: auto; padding: 4px;
    background: #1d1f23; border: 1px solid #34363b; border-radius: 8px;
  }
  .row {
    display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 6px;
  }
  a.row:hover, a.row:focus-visible { background: #2a2d32; outline: 0; }
  .row[aria-disabled='true'] { opacity: .5; }
  .name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 600 13px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .state { flex: none; font: 11px/1 ui-monospace, Consolas, monospace; color: #8b8f97; }
  .state.stopped { color: #ff6f61; }
  .tick { flex: none; width: 12px; color: #4ecb96; }
  /* Shape as well as colour, so the state never rests on colour alone. */
  .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #4ecb96; }
  .dot.stopped { background: #ff6f61; }
  .dot.no-plugin-server { background: none; box-shadow: inset 0 0 0 1.5px #666d78; }
  .none { margin: 0; padding: 10px; color: #8b8f97; }`;
}

/** A Plugin Name is not the program's to trust, so it is written as text. The
 *  Settings View writes what it shows the same way. */
export function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
