/**
 * The Settings View: a side list of its sections, the Places with their
 * Shelves, start at logon, the Shortcuts, and the App's version.
 *
 * It is one of the App's own pages (`pages.ts`): written here, loaded once as
 * a data address and then sent each new body, never served by the Host, so no
 * Plugin Page can reach it (ADR-0008). A change elsewhere on the page keeps
 * what the operator typed in a field; a form whose change was done is emptied
 * back to what it now says, and one that was refused keeps the typed text, so
 * the operator can correct it. What the operator types goes to the main process as one ask,
 * every part encoded, and the main process changes it through `core`
 * (`settings.ts`). The page checks nothing itself: `core` refuses what is
 * wrong, in the sentence a terminal would see, and the page shows it in the
 * outcome line, which stays in view while the page scrolls, and under the
 * field the refusal is about.
 *
 * Add a Place opens and closes in place, with no modal, and only where a
 * `wsl` Place can be (ADR-0021): elsewhere the one Place is this machine.
 * Whether it is open is the page's own state, which it sets again after
 * every body, as it does which section of the side list is current.
 */
import { canHoldWslPlace } from '@firstmate/core/places';
import { type IconName, icon } from '@firstmate/core/theme';
import { logonAsk, placeRemoveAsk, shelfChooseAsk, TYPED } from './ask.ts';
import { escaped, written, type Written } from './pages.ts';
import type { Field, PlaceShown, SettingsShown, ShortcutShown } from './settings.ts';

/** One section of the Settings View, as the side list names it. */
type Section = { readonly id: string; readonly icon: IconName; readonly words: string };

/** The sections, in the order the page shows them and the side list names them. */
const SECTIONS: readonly Section[] = [
  { id: 'places', icon: 'hard-drives', words: 'Places' },
  { id: 'logon', icon: 'power', words: 'Start at logon' },
  { id: 'shortcuts', icon: 'keyboard', words: 'Shortcuts' },
];

/** The icons any body of the Settings View may draw. */
const ICONS: readonly IconName[] = [
  ...SECTIONS.map((section) => section.icon),
  'terminal-window',
  'folder-open',
  'trash',
  'plus',
  'circle-notch',
  'check-circle',
  'warning-circle',
];

/** The Settings View. */
export function settingsPage(shown: SettingsShown): Written {
  const read = shown.saved.kind === 'read';
  const pane =
    shown.saved.kind === 'unread'
      ? `<section><div class="unread"><b>${icon('warning-circle')}The settings could not be read</b>
<p>${escaped(shown.saved.why)}</p></div></section>`
      : `${outcomeLine(shown)}
${placesSection(shown.saved.places, shown)}
${logonSection(shown.logon, shown.busy)}
${shortcutsSection(shown.saved.shortcuts)}
<p class="foot">Plugins, Grants and the Plugin Order change from a terminal:
<code>firstmate --help</code>.</p>`;
  return written(
    'Settings',
    styles(),
    `<div class="settings">
<nav class="side" aria-label="Settings">
<h1>Settings</h1>
${read ? SECTIONS.map(sideLink).join('\n') : ''}
<p class="ver">FirstMate ${escaped(shown.version)}</p>
</nav>
<main class="pane"${shown.busy ? ' aria-busy="true"' : ''}>
${pane}
</main>
</div>`,
    script(),
    ICONS,
  );
}

function sideLink(section: Section): string {
  return `<a href="#${section.id}" data-to="${section.id}">${icon(section.icon)}${section.words}</a>`;
}

function outcomeLine(shown: SettingsShown): string {
  if (shown.busy) {
    return `<div class="outcome" role="status">${icon('circle-notch', 'spin')}<span>Working…</span></div>`;
  }
  if (shown.outcome === undefined) return '';
  const { done, sentence } = shown.outcome;
  return `<div class="outcome ${done ? 'done' : 'refused'}" role="status">\
${icon(done ? 'check-circle' : 'warning-circle')}<span>${escaped(sentence)}</span></div>`;
}

/** The sentence under a field, and its mark, when the last refusal was about it. */
function mark(shown: SettingsShown, field: Field): { readonly on: string; readonly under: string } {
  const at = shown.busy ? undefined : shown.outcome?.field;
  if (at === undefined || shown.outcome === undefined || keyOf(at) !== keyOf(field)) {
    return { on: '', under: '' };
  }
  return {
    on: ' aria-invalid="true"',
    under: `<span class="err">${escaped(shown.outcome.sentence)}</span>`,
  };
}

/** One field, as one string, so two can be compared. */
function keyOf(field: Field): string {
  return field.form === 'shelf' ? `shelf/${field.place}` : `place-add/${field.name}`;
}

function placesSection(places: readonly PlaceShown[], shown: SettingsShown): string {
  const rows = places.map((place) => placeRow(place, shown)).join('\n');
  const add = canHoldWslPlace() ? `\n${addPlace(shown)}` : '';
  return `<section id="places">
<h2>Places</h2>
<p class="hint">A Place is where Plugins are installed and run. Each Place has its own Shelf, where
<code>firstmate install</code> puts a Plugin it fetches.</p>
<div class="group">
${rows}${add}
</div>
</section>`;
}

/**
 * Add a Place: one button, and the form it opens in place. Both are written
 * every time; the page's script says which of them shows.
 */
function addPlace(shown: SettingsShown): string {
  const field = (name: 'name' | 'kind' | 'distribution') =>
    mark(shown, { form: 'place-add', name });
  const name = field('name');
  const kind = field('kind');
  const distribution = field('distribution');
  return `<div class="addrow" data-key="add-row"><button type="button" class="btn quiet" \
data-add="open"${disabled(shown.busy)}>${icon('plus')}Add a Place</button></div>
<form class="addform" data-key="add-form" data-typed="${TYPED.placeAdd}" hidden>
<b>Add a Place</b>
<div class="cols">
<label class="field"><span>Name</span><input class="input mono" name="name" required \
placeholder="debian" autocomplete="off" spellcheck="false"${name.on}>${name.under}</label>
<label class="field"><span>Kind</span><select class="input" name="kind"${kind.on}>
<option value="wsl">wsl: a WSL distribution</option>
<option value="local">local: this machine</option>
</select>${kind.under}</label>
<label class="field for-wsl"><span>Distribution</span><input class="input" name="distribution" \
placeholder="Debian" autocomplete="off" spellcheck="false"${distribution.on}>${distribution.under}</label>
</div>
<div class="acts"><button type="button" class="btn" data-add="close">Cancel</button>\
<button class="btn primary"${disabled(shown.busy)}>Add</button></div>
</form>`;
}

function placeRow(place: PlaceShown, shown: SettingsShown): string {
  const name = escaped(place.name);
  const busy = shown.busy;
  const wsl = place.kind === 'wsl';
  const tag = wsl
    ? `wsl · ${escaped(place.distribution ?? '')}`
    : place.kind === 'local'
      ? 'this machine'
      : escaped(place.kind);
  // A local Place's Shelf is a folder on this machine, so it can be chosen; a
  // wsl Place's is a path inside the distribution, so it is typed.
  const choose = wsl
    ? ''
    : `<button type="button" class="btn" data-ask="${escaped(shelfChooseAsk(place.name))}"\
${disabled(busy)}>${icon('folder-open')}Choose…</button>`;
  const end = place.always
    ? 'Always here'
    : place.plugins.length > 0
      ? `Holds ${escaped(place.plugins.join(', '))}`
      : `<button type="button" class="btn quiet remove" title="Remove this Place" \
data-ask="${escaped(placeRemoveAsk(place.name))}"${disabled(busy)}>${icon('trash')}Remove</button>`;
  const shelf = mark(shown, { form: 'shelf', place: place.name });
  return `<div class="place" data-key="place:${name}">
<div class="head">${icon(wsl ? 'terminal-window' : 'hard-drives')}<b>${name}</b>\
<span class="tag">${tag}</span><span class="end">${end}</span></div>
<form data-typed="${TYPED.shelf}" data-place="${name}">
<label class="field"><span>Shelf</span><span class="inline">\
<input class="input mono" name="directory" value="${escaped(place.shelf)}" required \
autocomplete="off" spellcheck="false" aria-label="The Shelf of ${name}"${shelf.on}${disabled(busy)}>\
<button class="btn"${disabled(busy)}>Move</button>${choose}</span>${shelf.under}</label>
</form>
</div>`;
}

function logonSection(logon: boolean, busy: boolean): string {
  return `<section id="logon">
<h2>Start at logon</h2>
<div class="group"><div class="toggle-row"><div class="t"><b>Start FirstMate when you log on</b>
<span>It starts in the Tray, with the window hidden.</span></div>
<button type="button" class="switch" role="switch" aria-checked="${logon}" \
aria-label="Start FirstMate when you log on" data-ask="${escaped(logonAsk(!logon))}"\
${disabled(busy)}></button></div></div>
</section>`;
}

function shortcutsSection(shortcuts: readonly ShortcutShown[]): string {
  const rows =
    shortcuts.length === 0
      ? '<p class="none">No Shortcut is bound.</p>'
      : shortcuts.map(shortcutRow).join('\n');
  return `<section id="shortcuts">
<h2>Shortcuts</h2>
<p class="hint">Each Shortcut opens one address of one Plugin in a Popup. Bind and unbind them
from a terminal.</p>
<div class="group">
${rows}
</div>
<div class="cmd"><span class="p">&gt;</span>firstmate bind &lt;keys&gt; &lt;plugin&gt; [path]</div>
</section>`;
}

function shortcutRow(shortcut: ShortcutShown): string {
  const keys = shortcut.keys
    .split('+')
    .map((key) => `<kbd>${escaped(key)}</kbd>`)
    .join('+');
  return `<div class="shortcut" data-key="shortcut:${escaped(shortcut.keys)}">\
<span class="k">${keys}</span><code><i>/p/</i>${escaped(shortcut.plugin)}<i>/</i>\
${escaped(shortcut.path)}</code></div>`;
}

function disabled(busy: boolean): string {
  return busy ? ' disabled' : '';
}

/**
 * Each form sends one ask: its first words, then every field it has, in
 * order, each encoded. A field left empty, such as the distribution of a
 * local Place, is left out. The form is kept until the page has shown its
 * change worked on and then ended, and it is emptied only when it was done;
 * Add a Place then closes. The side list scrolls to its section in one click.
 */
function script(): string {
  return `let asking;
let adding = false;
let current = '';
const addForm = () => document.querySelector('form.addform');
const showAdding = () => {
  const form = addForm();
  const row = document.querySelector('.addrow');
  if (form) form.hidden = !adding;
  if (row) row.hidden = adding;
};
const showKind = () => {
  const kind = document.querySelector('form.addform select[name=kind]');
  const wsl = document.querySelector('form.addform .for-wsl');
  if (kind && wsl) wsl.hidden = kind.value !== 'wsl';
};
const showCurrent = () => {
  for (const link of document.querySelectorAll('.side a[data-to]')) {
    if (link.dataset.to === current) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
};
const openAdding = (open) => {
  adding = open;
  const form = addForm();
  if (!open && form) form.reset();
  showAdding();
  showKind();
  if (open && form) form.querySelector('input').focus();
  if (!open) document.querySelector('.addrow button')?.focus();
};
whenShown(() => {
  if (asking === undefined) return;
  if (document.querySelector('main[aria-busy]')) { asking.seen = true; return; }
  if (!asking.seen) return;
  if (document.querySelector('.outcome.done')) {
    asking.form.reset();
    if (asking.form === addForm()) adding = false;
  }
  asking = undefined;
});
whenShown(showAdding);
whenShown(showKind);
whenShown(() => {
  if (current === '') current = document.querySelector('.side a[data-to]')?.dataset.to ?? '';
  showCurrent();
});
addEventListener('change', showKind);
addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const add = target?.closest('[data-add]');
  if (add) { event.preventDefault(); openAdding(add.dataset.add === 'open'); return; }
  const link = target?.closest('.side a[data-to]');
  if (!link) return;
  event.preventDefault();
  current = link.dataset.to;
  showCurrent();
  document.getElementById(current)?.scrollIntoView({ block: 'start' });
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && adding && addForm()?.contains(event.target)) openAdding(false);
});
addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  asking = { form, seen: false };
  const parts = [form.dataset.typed];
  if (form.dataset.place !== undefined) parts.push(form.dataset.place);
  for (const field of form.querySelectorAll('input, select')) {
    if (field.closest('[hidden]') || field.value.trim() === '') continue;
    parts.push(field.value.trim());
  }
  firstmate.ask(parts.map((part, at) => at === 0 ? part : encodeURIComponent(part)).join('/'));
});`;
}

function styles(): string {
  return `* { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); }
  body { color: var(--text); font: 13px/1.5 var(--sans); }
  code, kbd, .mono { font-family: var(--mono); }
  code { font-size: 12.5px; color: var(--ink); }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .settings { display: grid; grid-template-columns: 188px minmax(0, 1fr); min-height: 100vh; }
  .side {
    position: sticky; top: 0; align-self: start; height: 100vh;
    border-right: 1px solid var(--line); padding: 20px 10px; background: var(--bg);
  }
  .side h1 { margin: 0 8px 12px; font-size: 15px; font-weight: 600; color: var(--ink); }
  .side a {
    display: flex; align-items: center; gap: 9px; height: 30px; padding: 0 8px;
    border-radius: var(--radius-control); color: var(--muted); text-decoration: none;
  }
  .side a:hover { background: var(--hover); color: var(--ink); }
  .side a[aria-current="true"] { background: var(--press); color: var(--ink); }
  .side .ver { margin: 18px 8px 0; font-size: 11.5px; color: var(--faint); }
  .pane { padding: 20px 32px 48px; max-width: 760px; min-width: 0; }
  .outcome {
    position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 9px;
    padding: 9px 12px; margin: 0 0 8px; border-radius: var(--radius-panel); font-size: 13px;
    background: var(--raised); border: 1px solid var(--line-2);
    animation: drop .18s var(--ease);
  }
  .outcome.done { color: var(--running); }
  .outcome.done span, .outcome.refused span { color: var(--text); }
  .outcome.refused {
    color: var(--stopped); border-color: color-mix(in srgb, var(--stopped) 40%, var(--line-2));
  }
  .outcome .spin { animation: spin .7s linear infinite; color: var(--accent); }
  @keyframes spin { to { transform: rotate(1turn); } }
  @keyframes drop { from { opacity: 0; transform: translateY(-2px); } }
  @media (prefers-reduced-motion: reduce) { .outcome, .outcome .spin { animation: none; } }
  .pane section { padding: 18px 0 8px; scroll-margin-top: 52px; }
  .pane h2 { margin: 0 0 4px; font-size: 14px; font-weight: 600; color: var(--ink); }
  .pane .hint { margin: 0 0 12px; color: var(--muted); font-size: 12.5px; }
  .group { border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--raised); }
  .group > :not([hidden]) ~ :not([hidden]) { border-top: 1px solid var(--line); }
  .place { padding: 12px 14px; }
  .place .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; min-width: 0; }
  .place .head svg.i { color: var(--muted); }
  .place .head b { color: var(--ink); font-weight: 600; }
  .tag {
    white-space: nowrap; font-size: 11.5px; padding: 1px 7px; border-radius: 999px;
    background: var(--chrome); border: 1px solid var(--line); color: var(--muted);
  }
  .place .head .end {
    margin-left: auto; font-size: 12px; color: var(--faint); text-align: right;
    display: flex; align-items: center; gap: 8px;
  }
  .field { display: grid; gap: 5px; }
  .field > span:first-child { font-size: 12px; color: var(--muted); }
  .field .err { font-size: 12px; color: var(--stopped); }
  .inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .inline .input { flex: 1; min-width: 220px; }
  .input {
    height: 32px; padding: 0 10px; border-radius: var(--radius-control);
    border: 1px solid var(--line-2); background: var(--bg); color: var(--ink);
    font: 13px var(--sans); outline: 0; min-width: 0;
  }
  .input.mono { font: 12.5px var(--mono); }
  .input:hover { border-color: var(--faint); }
  .input:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); outline: 0; }
  .input[aria-invalid="true"] { border-color: var(--stopped); }
  .btn {
    height: 32px; padding: 0 12px; border-radius: var(--radius-control);
    border: 1px solid var(--line-2); background: var(--bg); color: var(--text);
    font: 13px var(--sans); cursor: pointer; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 7px;
  }
  .btn:hover { background: var(--hover); border-color: var(--faint); color: var(--ink); }
  .btn:active { transform: scale(.97); background: var(--press); }
  .btn.primary {
    background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600;
  }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.quiet { border-color: transparent; background: none; color: var(--text); height: 26px; padding: 0 8px; }
  .btn.quiet:hover { background: var(--hover); }
  .btn.remove { color: var(--muted); }
  .btn.remove:hover { color: var(--stopped); }
  .btn:disabled, .input:disabled, .switch:disabled { opacity: .5; cursor: default; pointer-events: none; }
  @media (prefers-reduced-motion: no-preference) {
    .btn { transition: background .12s ease, color .12s ease, transform .12s ease-out; }
  }
  .addrow { padding: 10px 14px; }
  .addform { padding: 14px; display: grid; gap: 12px; }
  .addform > b { color: var(--ink); font-weight: 600; }
  .addform .cols { display: grid; grid-template-columns: 1fr 1.3fr 1fr; gap: 10px; align-items: start; }
  .addform .acts { display: flex; gap: 8px; justify-content: flex-end; }
  .toggle-row { display: flex; align-items: center; gap: 16px; padding: 12px 14px; }
  .toggle-row .t b { display: block; font-weight: 500; color: var(--ink); }
  .toggle-row .t span { font-size: 12.5px; color: var(--muted); }
  .switch {
    margin-left: auto; position: relative; width: 36px; height: 20px; border-radius: 999px;
    border: 0; padding: 0; background: var(--line-2); cursor: pointer; flex: none;
    transition: background .16s ease;
  }
  .switch::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .3);
    transition: transform .18s var(--ease);
  }
  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(16px); }
  .shortcut {
    display: grid; grid-template-columns: 190px 1fr; align-items: center; gap: 12px; padding: 10px 14px;
  }
  .shortcut .k { display: flex; gap: 4px; align-items: center; color: var(--faint); font-size: 11px; }
  .shortcut code i { font-style: normal; color: var(--faint); }
  kbd {
    display: inline-block; min-width: 18px; padding: 1px 5px; border-radius: 4px; text-align: center;
    border: 1px solid var(--line-2); border-bottom-width: 2px; background: var(--bg);
    font-size: 11px; line-height: 15px; color: var(--text);
  }
  .none { margin: 0; padding: 14px 12px; color: var(--muted); font-size: 12.5px; }
  .cmd {
    display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 8px 10px;
    border-radius: var(--radius-control); background: var(--chrome); border: 1px solid var(--line);
    font: 12.5px/1.4 var(--mono); color: var(--ink); width: fit-content; max-width: 100%;
  }
  .cmd .p { color: var(--faint); }
  .foot { margin-top: 28px; color: var(--faint); font-size: 12.5px; }
  .unread {
    padding: 18px; border-radius: var(--radius-panel); background: var(--stopped-soft);
    border: 1px solid color-mix(in srgb, var(--stopped) 40%, var(--line-2));
  }
  .unread b { display: flex; gap: 8px; align-items: center; color: var(--stopped); margin-bottom: 6px; }
  .unread p { margin: 0; }
  @media (max-width: 760px) {
    .settings { grid-template-columns: 1fr; }
    .side {
      position: static; height: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
      border-right: 0; border-bottom: 1px solid var(--line); padding: 10px 12px;
    }
    .side h1 { margin: 0 8px 0 0; }
    .side .ver { margin: 0 0 0 auto; }
    .pane { padding: 16px; }
    .addform .cols { grid-template-columns: 1fr; }
    .shortcut { grid-template-columns: 1fr; gap: 4px; }
  }`;
}
