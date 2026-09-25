# FirstMate

FirstMate is a local plugin host. It runs a person's own tools on their own machine and gives each one a process, a page and an address, so that no tool has to build a runtime of its own.

## Language

### The host

**Host**:
The single long-running FirstMate process. It supervises Plugins, serves their pages, and owns the address they are reached at.
_Avoid_: orchestrator, daemon, server, runtime, engine

**Index Page**:
The Host's own page. It lists every Plugin, its state, and a link to each Plugin Page.
_Avoid_: dashboard, home, shell

**Registry**:
The Host's record of which Plugins exist, where their directories are, and what Grants they hold.
_Avoid_: manifest, catalogue, config, lockfile

**Shelf**:
The directory a fetched Plugin lands in. The operator chooses it, the Host
remembers it in its settings file, and nothing ever scans it.
_Avoid_: store, library, vendor directory, plugins folder

**Tray**:
The Windows program that holds FirstMate's notification-area icon and shows the
Index Page and Plugin Pages in a window of its own.
_Avoid_: systray, notification icon, menu bar

**Shortcut**:
A key combination the Tray holds for all of Windows, bound from a terminal to
one address of one Plugin. Pressing it opens that address in a Popup.
_Avoid_: hotkey, keybinding, accelerator, bind

**Popup**:
The small window with no frame that a Shortcut opens, on top of every other
window. It is not the FirstMate window, and it hides when it loses focus or
when its page leaves its own address.
_Avoid_: quick window, overlay, modal, dialog

**Notice**:
A short message the Tray shows in a Windows pop-up, sent by a Plugin Server or
by the Host itself. It names who sent it, and a click opens the sender's
address. It has no severity: good news and bad news are both Notices.
_Avoid_: notification, warning, alert, toast

### Plugins

**Plugin**:
A directory the Host runs and serves. It may hold a Plugin Page and a Plugin Server, and nothing else is asked of it.
_Avoid_: extension, addon, module, integration, app

**Plugin Name**:
The name a Plugin is given when it enters the Registry. It identifies the Plugin in every address.
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
