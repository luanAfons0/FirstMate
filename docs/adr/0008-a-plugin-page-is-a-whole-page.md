# A plugin page is a whole page

The Index Page links to a Plugin Page and the browser goes there. The Host does not frame a Plugin Page under a control header of its own, though VS Code webviews, browser extensions, Figma and MCP Apps all do exactly that. The Host serves every Plugin Page from one origin, so a framed Plugin Page could read and rewrite the header around it and set `top.location`; the `sandbox` attribute that would stop it gives the frame a `null` Origin, and `src/security.ts` refuses a null Origin by design (ADR-0003). That leaves a header every Plugin can rewrite, or a Plugin that cannot reach its own tools. The Host frames nothing instead.

## Consequences

A Plugin Name stays the address. `/p/<name>/` is what the address bar shows, what a bookmark keeps, and what reload and the back button mean. The browser is the control surface FirstMate does not have to ship.

The Host has no persistent strip to put a control in, so anything a person needs across Plugins belongs on the Index Page or in the Tray. The Tray lists every Plugin for that reason.

A Plugin Page owns its whole viewport, and a Plugin is written for a page rather than for FirstMate's chrome.

## Amended: the Mate panel narrows the shown view (2.1)

The App's window has a strip since 2.0 (ADR-0020), and the Mate (ADR-0031) puts a panel beside the page. The panel is the App's own view, written by the App and loaded as a data address, never served by the Host. When it is open, the window narrows the shown view by the panel's width, as a narrower window would: a Plugin Page gets a resize, and keeps the whole of the area it is given. Expanded, the panel takes the whole width below the strip, and the shown view is hidden and stays loaded, as it is behind the Settings View. Nothing covers, frames or reaches into a page.

The window holds one key while it has the focus, Ctrl+Shift+K, which opens and closes the panel. It reads each key in each of its views before the page does, a Plugin Page too, and keeps that one key from the page. That is the whole of what it does there: it observes keys, injects nothing and reads nothing else of the page. The key is not a Shortcut: it is not global and nothing binds it from a terminal (ADR-0013).

A floating bar over a Plugin Page, as Shopify draws one over its Orders page, was considered and rejected. It covers part of the page's area, and a Plugin is written for a page that owns its whole viewport, not for FirstMate's chrome on top of it.
