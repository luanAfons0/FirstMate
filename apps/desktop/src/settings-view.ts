/**
 * The Settings View: the Places with their Shelves, start at logon, and the
 * Shortcuts.
 *
 * It is one of the App's own pages (`pages.ts`): written here, loaded once as
 * a data address and then sent each new body, never served by the Host, so no
 * Plugin Page can reach it (ADR-0008). A change elsewhere on the page keeps
 * what the operator typed in a field; a form whose change was done is emptied
 * back to what it now says, and one that was refused keeps the typed text, so
 * the operator can correct it. What the operator types goes to the main process as one ask,
 * every part encoded, and the main process changes it through `core`
 * (`settings.ts`). The page checks nothing itself: `core` refuses what is
 * wrong, in the sentence a terminal would see, and the page shows it.
 */
import { logonAsk, placeRemoveAsk, shelfChooseAsk, TYPED } from './ask.ts';
import { escaped, written, type Written } from './pages.ts';
import type { PlaceShown, SettingsShown, ShortcutShown } from './settings.ts';

/** The Settings View. */
export function settingsPage(shown: SettingsShown): Written {
  const body =
    shown.saved.kind === 'unread'
      ? `<p class="refused">${escaped(shown.saved.why)}</p>`
      : `${placesSection(shown.saved.places, shown.busy)}
${logonSection(shown.logon, shown.busy)}
${shortcutsSection(shown.saved.shortcuts)}`;
  return written(
    'Settings',
    styles(),
    `<main${shown.busy ? ' aria-busy="true"' : ''}>
<h1>Settings</h1>
${outcomeLine(shown)}
${body}
<p class="hint">Plugins, Grants and the Plugin Order change from a terminal:
<code>firstmate --help</code>.</p>
</main>`,
    script(),
  );
}

function outcomeLine(shown: SettingsShown): string {
  if (shown.busy) return '<p class="outcome" role="status">Working…</p>';
  if (shown.outcome === undefined) return '';
  const kind = shown.outcome.done ? 'done' : 'refused';
  return `<p class="outcome ${kind}" role="status">${escaped(shown.outcome.sentence)}</p>`;
}

function placesSection(places: readonly PlaceShown[], busy: boolean): string {
  const rows = places.map((place) => placeRow(place, busy)).join('\n');
  return `<section>
<h2>Places</h2>
<p class="hint">Where Plugins are installed and run. Each Place has its own Shelf, where
<code>firstmate install</code> puts a Plugin it fetches.</p>
${rows}
<form class="add" data-typed="${TYPED.placeAdd}">
<h3>Add a Place</h3>
<label>Name <input name="name" required placeholder="debian"
autocomplete="off" spellcheck="false"></label>
<label>Kind <select name="kind">
<option value="wsl">wsl: a WSL distribution</option>
<option value="local">local: this machine</option>
</select></label>
<label class="for-wsl">Distribution <input name="distribution" placeholder="Debian"
autocomplete="off" spellcheck="false"></label>
<button${disabled(busy)}>Add</button>
</form>
</section>`;
}

function placeRow(place: PlaceShown, busy: boolean): string {
  const name = escaped(place.name);
  const what =
    place.distribution === undefined
      ? escaped(place.kind)
      : `${escaped(place.kind)}, ${escaped(place.distribution)}`;
  // A local Place's Shelf is a folder on this machine, so it can be chosen; a
  // wsl Place's is a path inside the distribution, so it is typed.
  const choose =
    place.kind === 'wsl'
      ? ''
      : `<button type="button" data-ask="${escaped(shelfChooseAsk(place.name))}"${disabled(busy)}>\
Choose…</button>`;
  const remove = place.always
    ? '<span class="hint">Always here.</span>'
    : place.plugins.length > 0
      ? `<span class="hint">Holds ${escaped(place.plugins.join(', '))}.</span>`
      : `<button type="button" class="quiet" data-ask="${escaped(placeRemoveAsk(place.name))}"\
${disabled(busy)}>Remove</button>`;
  return `<div class="place" data-key="${name}">
<div class="head"><b>${name}</b> <span class="kind">${what}</span><span class="gap"></span>${remove}</div>
<form class="shelf" data-typed="${TYPED.shelf}" data-place="${name}">
<label>Shelf <input name="directory" value="${escaped(place.shelf)}" required
autocomplete="off" spellcheck="false"></label>
<button${disabled(busy)}>Move</button>${choose}
</form>
</div>`;
}

function logonSection(logon: boolean, busy: boolean): string {
  return `<section>
<h2>Start at logon</h2>
<label class="check"><input type="checkbox" data-ask="${escaped(logonAsk(!logon))}"\
${logon ? ' checked' : ''}${disabled(busy)}> Start FirstMate when you log on to Windows.
It begins in the Tray, with the window put away.</label>
</section>`;
}

function shortcutsSection(shortcuts: readonly ShortcutShown[]): string {
  const rows =
    shortcuts.length === 0
      ? '<p class="none">No Shortcut is bound.</p>'
      : `<dl>${shortcuts
          .map(
            (shortcut) =>
              `<dt><kbd>${escaped(shortcut.keys)}</kbd></dt><dd><code>${escaped(shortcut.address)}</code></dd>`,
          )
          .join('')}</dl>`;
  return `<section>
<h2>Shortcuts</h2>
${rows}
<p class="hint">Bind and unbind them from a terminal:
<code>firstmate bind &lt;keys&gt; &lt;plugin&gt; [path]</code>,
<code>firstmate unbind &lt;keys&gt;</code>.</p>
</section>`;
}

function disabled(busy: boolean): string {
  return busy ? ' disabled' : '';
}

/**
 * Each form sends one ask: its first words, then every field it has, in
 * order, each encoded. A field left empty, such as the distribution of a
 * local Place, is left out. The form is kept until the page has shown its
 * change worked on and then ended, and it is emptied only when it was done.
 */
function script(): string {
  return `let asking;
whenShown(() => {
  if (asking === undefined) return;
  if (document.querySelector('main[aria-busy]')) { asking.seen = true; return; }
  if (!asking.seen) return;
  if (document.querySelector('.outcome.done')) asking.form.reset();
  asking = undefined;
});
const show = () => {
  const kind = document.querySelector('form.add select[name=kind]');
  const wsl = document.querySelector('form.add .for-wsl');
  if (kind && wsl) wsl.hidden = kind.value !== 'wsl';
};
whenShown(show);
addEventListener('change', show);
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
  return `:root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #17181a; }
  body { color: #d6d8dc; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  main { max-width: 720px; padding: 24px 28px 40px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 12px; }
  h2 { font-size: 14px; font-weight: 600; margin: 28px 0 6px; }
  h3 { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: #b4b8bf; }
  p { margin: 6px 0; }
  .hint, .none, .kind { color: #8b8f97; font-size: 13px; }
  .outcome { padding: 8px 12px; border-radius: 6px; background: #24262a; }
  .outcome.done { color: #4ecb96; }
  .outcome.refused, .refused { color: #ff8f84; }
  .place, form.add {
    border: 1px solid #2c2e33; border-radius: 8px; padding: 10px 12px; margin: 8px 0;
  }
  .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .gap { flex: 1; }
  form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
  form.add { flex-direction: row; }
  form.add h3 { flex-basis: 100%; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #8b8f97; }
  form.shelf label { flex: 1; min-width: 240px; }
  label.check { flex-direction: row; align-items: baseline; gap: 8px; font-size: 14px; color: #d6d8dc; }
  input, select, button {
    font: 13px/1.2 ui-sans-serif, system-ui, Segoe UI, sans-serif; color: #d6d8dc;
    background: #1d1f23; border: 1px solid #34363b; border-radius: 6px; padding: 7px 9px;
  }
  input[name=directory] { font-family: ui-monospace, Consolas, monospace; }
  button { cursor: pointer; }
  button:hover { background: #24262a; border-color: #4a4d54; }
  button.quiet { padding: 3px 8px; }
  button:disabled, input:disabled { opacity: .5; cursor: default; }
  :focus-visible { outline: 2px solid #7aa2f7; outline-offset: 1px; }
  [hidden] { display: none !important; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 8px 0; }
  dd { margin: 0; }
  code, kbd { font: 13px/1.4 ui-monospace, Consolas, monospace; color: #d6d8dc; }`;
}
