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

**Tray**:
The Windows notification-area icon that opens the Index Page.
_Avoid_: systray, notification icon, menu bar

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
