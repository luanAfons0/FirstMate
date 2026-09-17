# A plugin page is a whole page

The Index Page links to a Plugin Page and the browser goes there. The Host does not frame a Plugin Page under a control header of its own, though VS Code webviews, browser extensions, Figma and MCP Apps all do exactly that. The Host serves every Plugin Page from one origin, so a framed Plugin Page could read and rewrite the header around it and set `top.location`; the `sandbox` attribute that would stop it gives the frame a `null` Origin, and `src/security.ts` refuses a null Origin by design (ADR-0003). That leaves a header every Plugin can rewrite, or a Plugin that cannot reach its own tools. The Host frames nothing instead.

## Consequences

A Plugin Name stays the address. `/p/<name>/` is what the address bar shows, what a bookmark keeps, and what reload and the back button mean. The browser is the control surface FirstMate does not have to ship.

The Host has no persistent strip to put a control in, so anything a person needs across Plugins belongs on the Index Page or in the Tray. The Tray lists every Plugin for that reason.

A Plugin Page owns its whole viewport, and a Plugin is written for a page rather than for FirstMate's chrome.
