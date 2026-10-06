/**
 * The Index Page: the Host's own page.
 *
 * It lists every Plugin in the Registry and links to each Plugin Page. It is
 * one file with no assets of its own, because the Host serves Plugin Pages and
 * has no business shipping a front end beside them. Its colours, dark and
 * light, and its state shapes are the App's own, from `@firstmate/core/theme`.
 *
 * A row is written as the address it leads to, because a Plugin Name is what
 * identifies a Plugin in every address, and a Plugin with no Plugin Page has
 * no address to show. That is the whole of what the Host knows to say.
 *
 * The filter is an enhancement, never a requirement: the list is whole in the
 * HTML and the script only hides rows, so the page still chooses a Plugin when
 * no script runs at all.
 *
 * The page has no form and shows no Shelf. Every Plugin Page is served from
 * this page's own origin, so a form here would be a form a Plugin Page could
 * send for itself, carrying a genuine cookie and a genuine Origin the Host
 * cannot tell from this page's own. It only says the words to type: the
 * Registry and the Shelf change from the terminal and the Settings View
 * (ADR-0012).
 */

import { STATE_WORDS, type PluginView } from '@firstmate/core/plugin-state';
import { THEME_STYLE } from '@firstmate/core/theme';

/** One Plugin, as the Index Page and the App both see it. */
/**
 * From this many Plugins up, the Index Page offers a filter. Below it the
 * whole list is already on screen, and a box that narrows three rows is noise.
 */
const FILTER_FROM = 7;

/** The whole Index Page, as one HTML document. */
export function indexPage(plugins: readonly PluginView[], registryPath: string): string {
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
  <h1>Plugins</h1>
  ${plugins.length === 0 ? '' : `<p class="count">${countOf(plugins)}</p>`}
</header>
${plugins.length === 0 ? emptyRegistry(registryPath) : list(plugins)}
${plugins.length < FILTER_FROM ? '' : script()}
</body>
</html>
`;
}

/** How many Plugins there are, and how many of them answer right now. */
function countOf(plugins: readonly PluginView[]): string {
  const running = plugins.filter((plugin) => plugin.state === 'running').length;
  const stopped = plugins.filter((plugin) => plugin.state === 'stopped').length;
  const all = plugins.length === 1 ? '1 Plugin' : `${plugins.length} Plugins`;
  // The Stopped count has its own colour, so a broken Plugin shows before the
  // list is read.
  const broken = stopped === 0 ? '' : ` · <span class="stopped">${stopped} Stopped</span>`;
  return `${all} · ${running} Running${broken}`;
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
  const more =
    plugin.state === 'stopped'
      ? `<span class="more">Its Plugin Server stopped. Start it again with \
<code>firstmate restart ${name}</code>.</span>`
      : '';

  if (!plugin.hasPage) {
    // A Plugin with no Plugin Page has nowhere to go, so the row is not a link
    // and shows the bare name instead of a path that would 404.
    return `<li data-name="${key}"><span class="row">${dot}<span class="address">\
<b>${name}</b></span><span class="note">no Plugin Page</span>${state}${more}</span></li>`;
  }
  // A Stopped Plugin still serves its Plugin Page, so it keeps its link.
  const href = `/p/${encodeURIComponent(plugin.name)}/`;
  return `<li data-name="${key}"><a class="row" href="${href}">${dot}<span class="address">\
<i>/p/</i><b>${name}</b><i>/</i></span>${state}${more}</a></li>`;
}

function filterBox(): string {
  return `<div class="filter" hidden>
  <input id="filter" type="text" placeholder="Filter Plugins" aria-label="Filter Plugins"
         autocomplete="off" spellcheck="false">
  <kbd aria-hidden="true">/</kbd>
</div>`;
}

function emptyRegistry(registryPath: string): string {
  return `<div class="start">
<h2>No Plugins are registered</h2>
<p>Install an Official Plugin, or register a directory of your own, from a terminal:</p>
<p class="cmd"><code>firstmate install research</code></p>
<p class="cmd"><code>firstmate add &lt;name&gt; &lt;dir&gt;</code></p>
<p class="where">The Registry is at <code>${escapeHtml(registryPath)}</code>.</p>
</div>`;
}

function styles(): string {
  return `${THEME_STYLE}
* { box-sizing: border-box; }
body {
  margin: 0 auto; padding: 3rem 1rem 4rem; max-width: 40rem;
  font: 16px/1.5 var(--sans);
  color: var(--text); background: var(--bg);
}
header {
  display: flex; align-items: baseline; gap: .75rem;
  margin: 0 0 1.75rem;
}
h1 { color: var(--ink); font-size: 1.0625rem; font-weight: 600; letter-spacing: -.01em; margin: 0; }
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
  border-radius: var(--radius-control); text-decoration: none; color: inherit;
}
a.row:hover { background: var(--raised); box-shadow: 0 0 0 1px var(--line); }
a.row:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
@media (prefers-reduced-motion: no-preference) {
  a.row { transition: background .1s ease, box-shadow .1s ease; }
}

.address {
  flex: 1; min-width: 0; font-family: var(--mono); font-size: .9375rem;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.address i { font-style: normal; color: var(--faint); }
.address b { font-weight: 600; }

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
  background: none; border: 0; border-radius: var(--radius-control);
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

.count .stopped { color: var(--stopped); }
.row { flex-wrap: wrap; }
.more { flex-basis: 100%; padding-left: 1.5rem; font-size: .8125rem; color: var(--muted); }
.start h2 { margin: 0 0 .5rem; font-size: 1rem; color: var(--ink); }
.cmd { margin: .4rem 0 0; }
.cmd code {
  display: block; padding: .5rem .75rem; font-size: .875rem; color: var(--ink);
  background: var(--raised); border: 1px solid var(--line); border-radius: var(--radius-control);
}
.where { margin-top: 1rem; font-size: .8125rem; color: var(--faint); }
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
