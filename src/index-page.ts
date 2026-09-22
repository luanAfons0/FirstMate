/**
 * The Index Page: the Host's own page.
 *
 * It lists every Plugin in the Registry and links to each Plugin Page. It is
 * one file with no assets of its own, because the Host serves Plugin Pages and
 * has no business shipping a front end beside them.
 *
 * A row is written as the address it leads to, because a Plugin Name is what
 * identifies a Plugin in every address, and a Plugin with no Plugin Page has
 * no address to show. That is the whole of what the Host knows to say.
 *
 * The filter is an enhancement, never a requirement: the list is whole in the
 * HTML and the script only hides rows, so the page still chooses a Plugin when
 * no script runs at all.
 *
 * The page says where a fetched Plugin lands and never sets it. Every Plugin
 * Page is served from this page's own origin, so a form here would be a form
 * a Plugin Page could send for itself, carrying a genuine cookie and a genuine
 * Origin the Host cannot tell from this page's own. The Shelf moves from the
 * terminal alone (ADR-0012).
 */

import type { PluginState } from './supervisor.ts';

export type PluginView = {
  /** The Plugin Name, which is also its address. */
  readonly name: string;
  /** Whether the Plugin ships a Plugin Page for the Host to link to. */
  readonly hasPage: boolean;
  /** What the Host knows about this Plugin's Plugin Server right now. */
  readonly state: PluginState;
};

/** The one word FirstMate says about a Plugin Server, wherever it says it. */
export const STATE_WORDS: Readonly<Record<PluginState, string>> = {
  running: 'Running',
  stopped: 'Stopped',
  'no-plugin-server': 'no Plugin Server',
};

/**
 * From this many Plugins up, the Index Page offers a filter. Below it the
 * whole list is already on screen, and a box that narrows three rows is noise.
 */
const FILTER_FROM = 7;

export function indexPage(
  plugins: readonly PluginView[],
  registryPath: string,
  shelf: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FirstMate</title>
<style>
${styles()}
</style>
</head>
<body>
<header>
  <h1>FirstMate</h1>
  ${plugins.length === 0 ? '' : `<p class="count">${countOf(plugins)}</p>`}
</header>
${plugins.length === 0 ? emptyRegistry(registryPath) : list(plugins)}
${shelfNote(shelf)}
${plugins.length < FILTER_FROM ? '' : script()}
</body>
</html>
`;
}

/** How many Plugins there are, and how many of them answer right now. */
function countOf(plugins: readonly PluginView[]): string {
  const running = plugins.filter((plugin) => plugin.state === 'running').length;
  const all = plugins.length === 1 ? '1 Plugin' : `${plugins.length} Plugins`;
  return `${all} · ${running} Running`;
}

function list(plugins: readonly PluginView[]): string {
  const filter = plugins.length < FILTER_FROM ? '' : filterBox();
  return `${filter}
<ul>
${plugins.map(row).join('\n')}
</ul>
<p id="no-match" class="empty" role="status" hidden></p>`;
}

/**
 * One Plugin, written as its address. The Plugin Name is the lit segment of
 * the path, because the name is the only part of the address a person picks.
 */
function row(plugin: PluginView): string {
  const name = escapeHtml(plugin.name);
  const key = escapeHtml(plugin.name.toLowerCase());
  const dot = `<span class="dot ${plugin.state}" aria-hidden="true"></span>`;
  const state = `<span class="state ${plugin.state}">${STATE_WORDS[plugin.state]}</span>`;

  if (!plugin.hasPage) {
    // A Plugin with no Plugin Page has nowhere to go, so the row is not a link
    // and shows the bare name instead of a path that would 404.
    return `<li data-name="${key}"><span class="row">${dot}<span class="address">\
<b>${name}</b></span><span class="note">no Plugin Page</span>${state}</span></li>`;
  }
  // A Stopped Plugin still serves its Plugin Page, so it keeps its link.
  const href = `/p/${encodeURIComponent(plugin.name)}/`;
  return `<li data-name="${key}"><a class="row" href="${href}">${dot}<span class="address">\
<i>/p/</i><b>${name}</b><i>/</i></span>${state}</a></li>`;
}

function filterBox(): string {
  return `<div class="filter" hidden>
  <input id="filter" type="text" placeholder="Filter Plugins" aria-label="Filter Plugins"
         autocomplete="off" spellcheck="false">
  <kbd aria-hidden="true">/</kbd>
</div>`;
}

function emptyRegistry(registryPath: string): string {
  return `<p>No Plugins are registered. The Registry is at <code>${escapeHtml(
    registryPath,
  )}</code>.</p>
<p>Add one with <code>node src/cli.ts add &lt;name&gt; &lt;dir&gt;</code>.</p>`;
}

/**
 * Where a fetched Plugin lands, and the command that moves it. It is shown
 * whatever the Registry holds, because the answer to "where would a Plugin
 * land" does not depend on whether one has landed yet.
 */
function shelfNote(shelf: string): string {
  return `<footer>
<p>A fetched Plugin lands in <code>${escapeHtml(shelf)}</code>. Move it with
<code>node src/cli.ts shelf &lt;dir&gt;</code>.</p>
</footer>`;
}

function styles(): string {
  return `:root {
  color-scheme: light dark;
  --paper: #fcfcfb;
  --raised: #ffffff;
  --ink: #16181d;
  --muted: #6b7280;
  --faint: #a4abb5;
  --line: rgba(22, 24, 29, .11);
  --live: #157f57;
  --stopped: #b3261e;
  --focus: #2f6feb;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #131519;
    --raised: #1a1d23;
    --ink: #e7e9ec;
    --muted: #98a0aa;
    --faint: #666d78;
    --line: rgba(231, 233, 236, .13);
    --live: #4ecb96;
    --stopped: #ff6f61;
    --focus: #7aa2f7;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 3rem 1rem 4rem; max-width: 40rem;
  font: 16px/1.5 system-ui, sans-serif;
  color: var(--ink); background: var(--paper);
}
header {
  display: flex; align-items: baseline; gap: .75rem;
  margin: 0 0 1.75rem;
}
h1 { font-size: 1.0625rem; font-weight: 600; letter-spacing: -.01em; margin: 0; }
.count {
  margin: 0; font-family: var(--mono); font-size: .75rem;
  color: var(--faint); font-variant-numeric: tabular-nums;
}
ul { list-style: none; margin: 0; padding: 0; }
li + li { border-top: 1px solid var(--line); }

/* The whole row is the target, so choosing a Plugin never needs precision. */
.row {
  display: flex; align-items: center; gap: .75rem;
  padding: .8rem .75rem; margin: 0 -.75rem;
  border-radius: 7px; text-decoration: none; color: inherit;
}
a.row:hover { background: var(--raised); box-shadow: 0 0 0 1px var(--line); }
a.row:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
@media (prefers-reduced-motion: no-preference) {
  a.row { transition: background .1s ease, box-shadow .1s ease; }
}

.address {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: .9375rem;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.address i { font-style: normal; color: var(--faint); }
.address b { font-weight: 600; }

/* Shape as well as colour, so the state never rests on colour alone. */
.dot {
  flex: none; width: .5rem; height: .5rem; border-radius: 50%;
  background: var(--live);
}
.dot.stopped { background: var(--stopped); }
.dot.no-plugin-server { background: none; box-shadow: inset 0 0 0 1.5px var(--faint); }

.state {
  flex: none; font-family: var(--mono); font-size: .75rem; color: var(--muted);
}
.state.stopped { color: var(--stopped); }
.state.no-plugin-server { color: var(--faint); }
.note { flex: none; font-size: .75rem; color: var(--faint); }

/* The filter is the quietest thing here: the list is what the page is for. */
.filter { position: relative; margin: 0 -.75rem .25rem; }
#filter {
  width: 100%; padding: .45rem 2rem .45rem .75rem;
  font: inherit; font-size: .875rem; color: inherit;
  background: none; border: 0; border-radius: 7px;
}
#filter::placeholder { color: var(--faint); }
#filter:focus-visible { outline: 0; background: var(--raised); box-shadow: 0 0 0 1px var(--line); }
kbd {
  position: absolute; right: .75rem; top: 50%; transform: translateY(-50%);
  font-family: var(--mono); font-size: .6875rem; color: var(--faint);
  pointer-events: none;
}
#filter:focus-visible + kbd { opacity: 0; }
.empty, p { color: var(--muted); }
.empty { font-size: .875rem; }
code { font-family: var(--mono); font-size: .8125em; }

/* The quietest thing on the page: an answer for whoever goes looking. */
footer { margin: 2.5rem 0 0; padding-top: 1rem; border-top: 1px solid var(--line); }
footer p { margin: 0; font-size: .8125rem; color: var(--faint); }
@media (max-width: 30rem) {
  body { padding-top: 2rem; }
  .row { gap: .6rem; padding-inline: .5rem; margin-inline: -.5rem; }
  .note { display: none; }
}`;
}

/**
 * The filter, the one script this page has. It reads the rows and never the
 * server's words, so there is nothing here for a Plugin Name to escape into.
 */
function script(): string {
  return `<script>
(() => {
  const box = document.querySelector('.filter');
  const input = document.getElementById('filter');
  const none = document.getElementById('no-match');
  const rows = Array.from(document.querySelectorAll('li[data-name]'));
  if (!box || !input || !none) return;
  box.hidden = false;

  const links = () => rows.filter((r) => !r.hidden).map((r) => r.querySelector('a.row'));

  const apply = () => {
    const want = input.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const hit = row.dataset.name.includes(want);
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    none.hidden = shown > 0;
    none.textContent = shown > 0 ? '' : 'No Plugin matches ' + input.value.trim() + '.';
  };

  const step = (from, by) => {
    const open = links().filter(Boolean);
    if (open.length === 0) return;
    const at = open.indexOf(from);
    const next = at < 0 ? (by > 0 ? 0 : open.length - 1) : at + by;
    open[Math.min(Math.max(next, 0), open.length - 1)].focus();
  };

  input.addEventListener('input', apply);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { input.value = ''; apply(); input.blur(); }
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      step(null, 1);
    }
  });

  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLInputElement;
    if (event.key === '/' && !typing) { event.preventDefault(); input.focus(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (typing) return;
    event.preventDefault();
    step(event.target.closest ? event.target.closest('a.row') : null,
         event.key === 'ArrowDown' ? 1 : -1);
  });
})();
</script>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
