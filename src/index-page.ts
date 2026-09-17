/**
 * The Index Page: the Host's own page.
 *
 * It lists every Plugin in the Registry and links to each Plugin Page. It is
 * one file with no assets of its own, because the Host serves Plugin Pages and
 * has no business shipping a front end beside them.
 */

export type PluginView = {
  /** The Plugin Name, which is also its address. */
  readonly name: string;
  /** Whether the Plugin ships a Plugin Page for the Host to link to. */
  readonly hasPage: boolean;
};

export function indexPage(plugins: readonly PluginView[], registryPath: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FirstMate</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0 auto; padding: 2rem 1rem; max-width: 42rem;
  font: 16px/1.5 system-ui, sans-serif;
}
h1 { font-size: 1.25rem; margin: 0 0 1.5rem; }
ul { list-style: none; margin: 0; padding: 0; }
li {
  display: flex; gap: 1rem; align-items: baseline;
  padding: .75rem 0; border-top: 1px solid rgba(127,127,127,.3);
}
li :first-child { flex: 1; }
.quiet { opacity: .6; }
p { color: inherit; opacity: .7; }
code { font-size: .9em; }
</style>
</head>
<body>
<h1>FirstMate</h1>
${plugins.length === 0 ? emptyRegistry(registryPath) : list(plugins)}
</body>
</html>
`;
}

function list(plugins: readonly PluginView[]): string {
  return `<ul>
${plugins.map(row).join('\n')}
</ul>`;
}

function row(plugin: PluginView): string {
  const name = escapeHtml(plugin.name);
  const link = plugin.hasPage
    ? `<a href="/p/${encodeURIComponent(plugin.name)}/">${name}</a>`
    : `<span>${name}</span>`;
  const note = plugin.hasPage ? '' : '<span class="quiet">no Plugin Page</span>';
  return `<li>${link}${note}</li>`;
}

function emptyRegistry(registryPath: string): string {
  return `<p>No Plugins are registered. The Registry is at <code>${escapeHtml(
    registryPath,
  )}</code>.</p>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
