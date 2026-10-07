# A Plugin's settings are at #settings of its Plugin Page

The Settings View holds every setting of FirstMate: the Places, the Plugin Order, start at logon and the Shortcuts. It said nothing about the settings of each Plugin. A Plugin keeps those in a file in its own directory, and its Plugin Page edits them through its own tools (ADR-0005). scribe and research show them at `/p/<name>/#settings`, so an operator had to open the Plugin first, then find its settings there. The spec is issue #200.

So a Plugin that has settings serves them at `/p/<name>/#settings`: its own Plugin Page, which reads the fragment and shows its Plugin Settings. The Settings View gains a Plugin Settings section. It lists every Plugin in the Plugin Order, from the rows `/plugins.json` already gives, and each Plugin that ships a Plugin Page has an Open settings button. The button opens that address in the Plugin's own view, as the switcher opens a Plugin Page, and the Settings View closes.

The App shows the button for every Plugin with a Plugin Page, and it does not try to find out whether the Plugin has settings. A Plugin with none is free to ignore the fragment, and the button then opens its Plugin Page as it always opens. A Plugin with no Plugin Page has nothing to open, so its row says so and has no button.

The button's ask carries the Plugin Name alone. The main process makes the address, checks that the Host names the Plugin and that it ships a Plugin Page, and opens it. It takes that ask from the Settings View alone, as it takes every ask that changes a setting. A Plugin Page has no preload, so it cannot ask at all, and no Plugin can open another Plugin's settings through the window (ADR-0009).

ADR-0002 is unchanged: this adds no manifest and no schema, only an address the Plugin already owns. ADR-0005 is unchanged: the App reads and writes no Plugin's settings, and the Host still keeps none. `/plugins.json` keeps its shape.

## Considered Options

A form the App draws for every Plugin, from a `get_settings` tool and an `update_settings` tool each Plugin Server would offer. That is a settings schema every Plugin must follow, which ADR-0002 refused, and it puts the App in charge of each Plugin's settings, which ADR-0005 refused. A Plugin knows best how its own settings look.

A signal each Plugin declares, such as a file or a field, that the Host reports in `/plugins.json`, so the button shows only for a Plugin that has settings. That changes the Plugin contract and the shape of `/plugins.json` for a button that is harmless without it.

## Consequences

`#settings` is a convention, written in the Plugin guide. Nothing checks it: a Plugin that ignores it still works, and its button opens its Plugin Page.

The fragment never reaches the Host. When the Plugin's view already shows its Plugin Page, only the fragment changes, so the page hears a `hashchange` and not a new load. A Plugin that has settings reads `location.hash` when it loads and on every `hashchange`.

A Stopped Plugin keeps its button, because its Plugin Page is still served, and a Plugin that needs a setting to start is set up there.

The window has no automated test (ADR-0020), so the section is checked by hand on the packaged App.
