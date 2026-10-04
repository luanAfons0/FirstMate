# The operator chooses the Plugin Order

Every list of Plugins showed them in Registry order, which is the order they were added in. The Plugins used most could sit at the bottom of the Index Page, of the Tray menu and of anything else that lists them, and the operator had no way to change that. So the operator now chooses the Plugin Order. It is kept in `settings.json` under an `order` key, as a list of Plugin Names, and it is set with `firstmate order <name> <position>`. This narrows ADR-0012 a second time, after ADR-0013: the Host now keeps three settings, and all three are written from a terminal and from nowhere else, for the reason that ADR gives. If an address on the Host could reorder the Plugins, every Plugin Page could, because same-origin is not a trust boundary on this Host.

The Host reads the order on every request, as it reads the Shortcuts, and sorts the list before the Index Page and `/plugins.json` use it. The Plugins the order names come first, in that order. Every Plugin it does not name follows, in Registry order, so a Plugin that is added goes to the bottom and nothing has to write the order to put it there. A name the Registry does not hold is passed over, so that a settings file edited by hand does not stop the Host. A name held twice is damage, and it fails every command, as a damaged Shortcut does.

## Considered Options

The order of the rows in the Registry, which needs no new key at all. The Host reads the Registry once, when it starts, and starts every Plugin Server from it. A new order would then need a restart of the Host, and so of every Plugin Server, for a change that is only about how a list looks. The Registry is the record of which Plugins exist; the order they are shown in is the operator's choice about the screen.

Drag handles on the Index Page, with the order kept in the browser's own storage. Each browser would hold a different order, the Tray could not read it, and every Plugin Page shares the Index Page's origin, so any Plugin could rewrite it.

## Consequences

`/plugins.json` keeps its shape. Only the order of its items changes, so the Tray menu follows the Plugin Order with no change to the window.

`firstmate list` keeps Registry order. It is the view of the Registry, and the Registry has not changed.

`remove` takes the Plugin out of the order, so that a later Plugin with the same name does not inherit an old place.

A settings file damaged under a running Host is said and not served, on the Index Page and on `/plugins.json` as on `/shortcuts.json`. The Tray then shows that the Host would not say, which is true.

