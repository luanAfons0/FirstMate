# FirstMate

FirstMate is a local plugin host. It runs a person's own tools on their own machine and gives each one a process, a page and an address, so that no tool has to build a runtime of its own.

## Language

### The host

**App**:
The FirstMate program a person installs and runs. It holds the Host, the Tray and the window.
_Avoid_: desktop, client, application, shell

**Host**:
The part of the App that supervises Plugins, serves their pages, and owns the address they are reached at.
_Avoid_: orchestrator, daemon, server, runtime, engine

**Index Page**:
The Host's own page. It lists every Plugin, its state, and a link to each Plugin Page.
_Avoid_: dashboard, home, shell

**Registry**:
The Host's record of which Plugins exist, which Place each is in, where their directories are, and what Grants they hold.
_Avoid_: manifest, catalogue, config, lockfile

**Plugin Order**:
The order every list of Plugins shows them in, chosen by the operator. A Plugin it does not name follows, in the order it was added.
_Avoid_: sort, ranking, priority

**Settings View**:
The window's own page for FirstMate's settings, opened from the gear in the strip. The Host never serves it, so no Plugin Page can reach it.
_Avoid_: preferences, options, config page, settings page

**Place**:
A named location where Plugins are installed and their Plugin Servers run, such
as this machine or one WSL distribution (WSL on Windows only). A Plugin is in one Place.
_Avoid_: environment, target, runtime, machine, host

**Shelf**:
The directory a fetched Plugin lands in. Each Place has its own. The operator
chooses it, the Host remembers it in its settings file, and nothing ever scans it.
_Avoid_: store, library, vendor directory, plugins folder

**Tray**:
The App's notification-area icon and its menu.
_Avoid_: systray, notification icon, menu bar

**Shortcut**:
A key combination the App holds for the whole desktop, bound from a terminal to
one address of one Plugin. Pressing it opens that address in a Popup.
_Avoid_: hotkey, keybinding, accelerator, bind

**Popup**:
The small window with no frame that a Shortcut opens, on top of every other
window. It is not the FirstMate window, and it hides when it loses focus or
when its page leaves its own address.
_Avoid_: quick window, overlay, modal, dialog

**Notice**:
A short message the App shows as a desktop pop-up, sent by a Plugin Server or
by the Host itself. It names who sent it, and a click opens the sender's
address. It has no severity: good news and bad news are both Notices.
_Avoid_: notification, warning, alert, toast

### Plugins

**Plugin**:
A directory the Host runs and serves. It may hold a Plugin Page and a Plugin Server, and nothing else is asked of it.
_Avoid_: extension, addon, module, integration, app

**Official Plugin**:
A Plugin the FirstMate project itself offers, known to FirstMate by name and
address before it is fetched. It is not in the Registry until it is installed,
and once installed it is a Plugin like any other.
_Avoid_: catalogue, marketplace, store, featured, recommended

**Plugin Name**:
The name a Plugin is given when it enters the Registry. It is unique across every Place and identifies the Plugin in every address.
_Avoid_: id, slug, key

**Plugin Page**:
The web interface a Plugin ships and owns. The Host serves it and never reaches inside it.
_Avoid_: view, board, dashboard, UI, frontend

**Plugin Server**:
The MCP server a Plugin ships. Its tools are everything the Plugin can do.
_Avoid_: backend, worker, daemon, adapter

**Stopped**:
The state of a Plugin whose Plugin Server is no longer running.
_Avoid_: crashed, failed, dead, unhealthy

### Between plugins

**Tool Bus**:
The Host in its role of carrying a call from one Plugin to another Plugin's tools.
_Avoid_: broker, router, event bus, IPC

**Grant**:
Permission for one named Plugin to call another named Plugin's tools. A Grant covers one pair.
_Avoid_: permission, scope, capability, ACL

**Sampling**:
A Plugin asking the Host for a model completion instead of holding a model key of its own.
_Avoid_: inference, completion, LLM call, AI call
