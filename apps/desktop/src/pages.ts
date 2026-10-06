/**
 * The App's own pages: the strip and the switcher, and what every one of the
 * App's pages shares. The Settings View is `settings-view.ts`.
 *
 * The strip says where the window is as a breadcrumb, FirstMate and then the
 * Plugin that is open, and each part goes somewhere: FirstMate to the Index
 * Page, the last part to the switcher, which lists every Plugin in the Plugin
 * Order. Beside it are "open in browser" and the gear that opens the Settings
 * View. It is the 1.x strip, carried over.
 *
 * Each page is one file with no assets of its own, written here and loaded as
 * a data address. The Host never serves one, and must never serve one: every
 * Plugin Page shares an origin with the Index Page, so a strip the Host served
 * would be a strip a Plugin Page could read and rewrite (ADR-0008). A page asks
 * the main process for something through `firstmate.ask`, which only these
 * pages carry (`preload.ts`).
 *
 * A page is written again rather than scripted when what it says changes: it
 * is small, and loading it again costs less than reaching into it would.
 */
import { STATE_WORDS } from '@firstmate/core/plugin-state';
import { ASK, openAsk } from './ask.ts';
import type { Plugins } from './host-lists.ts';

/** Where the window is: the Index Page, one Plugin Page, or the Settings View. */
export type Here =
  | { readonly kind: 'list' }
  | { readonly kind: 'plugin'; readonly name: string }
  | { readonly kind: 'settings' };

/** Everything the strip says. */
export type StripView = {
  readonly here: Here;
  /** Whether the switcher is open. */
  readonly switcher: boolean;
  /** What went wrong with the last thing asked for, until the next one. */
  readonly fault: string | undefined;
};

/** How tall the strip is, in logical pixels. */
export const STRIP_HEIGHT = 44;

/** How wide the switcher is, in logical pixels. */
export const SWITCHER_WIDTH = 360;

/** How far the switcher sits from the window's left edge, under the breadcrumb. */
export const SWITCHER_LEFT = 8;

/** How tall one row of the switcher is, and the space around the rows. */
const ROW = 34;
const AROUND = 10;

/**
 * What a page may do. It runs its own inline script and style and nothing
 * else: it loads nothing, connects nowhere and is framed by nothing.
 */
const POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none'";

/** How tall the switcher needs to be to show every row. The window holds it
 *  inside its own height, and the rows scroll past that. */
export function switcherHeight(plugins: Plugins): number {
  const rows = plugins.kind === 'told' ? Math.max(plugins.plugins.length, 1) : 1;
  return rows * ROW + AROUND;
}

/** A page, as the address a view loads it from. */
export function dataAddress(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** The strip, as one HTML document. */
export function stripPage(view: StripView): string {
  const atTheList = view.here.kind === 'list';
  const crumbs = `<a class="crumb" href="#" data-ask="${ASK.pluginList}"\
${atTheList ? ' aria-disabled="true"' : ''} title="See the Plugin list">\
<span aria-hidden="true">⌂</span> FirstMate</a>
<span class="sep" aria-hidden="true">›</span>
<a class="crumb last" href="#" data-ask="${view.switcher ? ASK.switcherClose : ASK.switcher}" \
aria-expanded="${view.switcher}" title="Switch Plugin">${hereWords(view.here)} \
<span aria-hidden="true">▾</span></a>`;
  return page(
    'FirstMate',
    stripStyles(),
    `<nav class="bar">
${crumbs}
${view.fault === undefined ? '' : `<span class="fault">${escaped(view.fault)}</span>`}
<span class="gap"></span>
<a class="button" href="#" data-ask="${ASK.openInBrowser}" \
title="Open what is shown here in the system browser">open in browser</a>
<a class="button gear" href="#" data-ask="${ASK.settings}" title="Settings" aria-label="Settings" \
aria-pressed="${view.here.kind === 'settings'}">⚙</a>
</nav>`,
    '',
  );
}

/** The last part of the breadcrumb: what is open. */
function hereWords(here: Here): string {
  if (here.kind === 'plugin') return `<b>${escaped(here.name)}</b>`;
  return here.kind === 'settings' ? '<b>Settings</b>' : 'Plugins';
}

/**
 * The switcher, as one HTML document: every Plugin, or the one sentence that
 * stands in for the list. Its script works its keys and closes it when it
 * loses the focus.
 */
export function switcherPage(open: string | undefined, plugins: Plugins): string {
  const rows =
    plugins.kind === 'untold'
      ? '<p class="none">The Host would not say which Plugins there are.</p>'
      : plugins.plugins.length === 0
        ? '<p class="none">No Plugin is registered.</p>'
        : plugins.plugins
            .map((plugin) => {
              const dot = `<span class="dot ${plugin.state}" aria-hidden="true"></span>`;
              const words = `${dot}<span class="name">${escaped(plugin.name)}</span>\
<span class="state ${plugin.state}">${STATE_WORDS[plugin.state]}</span>`;
              // A Plugin with no Plugin Page has nowhere to go, so it is shown
              // and not offered. A Stopped Plugin is still offered: the Host
              // serves its page whatever its Plugin Server does.
              if (!plugin.hasPage) {
                return `<span class="row" aria-disabled="true">${words}<span class="tick"></span></span>`;
              }
              const here = plugin.name === open;
              return `<a class="row" href="#" data-ask="${escaped(openAsk(plugin.name))}"\
${here ? ' aria-current="page"' : ''}>${words}<span class="tick" aria-hidden="true">\
${here ? '✓' : ''}</span></a>`;
            })
            .join('\n');
  return page(
    'Plugins',
    switcherStyles(),
    `<div class="panel" role="menu" aria-label="Plugins">
${rows}
</div>`,
    `const close = () => firstmate.ask('${ASK.switcherClose}');
const rows = Array.from(document.querySelectorAll('.panel a.row'));
const start = document.querySelector('.panel a[aria-current]') || rows[0];
if (start) start.focus();
addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); close(); return; }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const at = rows.indexOf(document.activeElement);
  const by = event.key === 'ArrowDown' ? 1 : -1;
  const next = at < 0 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1);
  if (rows[next]) rows[next].focus();
});
// A click anywhere else in the window takes the focus away from the switcher.
addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) close(); }, 120));`,
  );
}

/**
 * One whole page: its policy, its style, its body, and the one script every
 * page shares, which sends a click on anything with `data-ask` to the main
 * process.
 */
export function page(title: string, style: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<title>${title}</title>
<style>
${style}
</style>
${body}
<script>
addEventListener('click', (event) => {
  const asking = event.target instanceof Element ? event.target.closest('[data-ask]') : null;
  if (asking === null) return;
  event.preventDefault();
  if (asking.getAttribute('aria-disabled') !== 'true') firstmate.ask(asking.dataset.ask);
});
${script}
</script>
</html>`;
}

function stripStyles(): string {
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
  .gear[aria-pressed='true'] { background: #2b2e33; border-color: #4a4d54; }`;
}

function switcherStyles(): string {
  return `:root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100vh; overflow: hidden; background: #1d1f23; }
  body { color: #d6d8dc; font: 13px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  a { color: inherit; text-decoration: none; }
  .panel {
    height: 100vh; overflow-y: auto; padding: 4px;
    background: #1d1f23; border: 1px solid #34363b;
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

/** A Plugin Name, or anything else read from a file, is written as text. */
export function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
