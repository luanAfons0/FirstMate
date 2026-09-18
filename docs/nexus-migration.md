# The nexus migration

`~/.nexus` is FirstMate's first Plugin, and the migration that made it one is
finished. This records what moved, what proved it, and what nexus deleted, so
that the second Plugin has a worked example and nobody reopens a decision that
is already closed.

## What moved

Nexus once owned everything a tool needs to put a page on screen. It owned one
of each because nothing else would give it one. That is the reason FirstMate
exists, and the migration is the argument made once, in full:

| Nexus once shipped                          | The Host ships one, for every Plugin |
| ------------------------------------------- | ------------------------------------ |
| a loopback listener, `scripts/lib/ui_server.py` | `src/host.ts`                    |
| a static allowlist                          | `src/static-files.ts`                |
| a Run Token, a Run File, a stale-run probe  | `src/runtime.ts`, `src/security.ts`  |
| five PowerShell files of its own tray       | the Tray, in `windows/`              |
| `nexus ui`, with `--status`, `--stop`, `--open` | the Tray, and the address `/p/nexus/` |

## What v1 proved

Served from `~/.nexus/web/`, unchanged, with the Host running as a systemd
service: `index.html`, `app.css`, `app.js` and `vendor/marked.min.js` all
loaded from `/p/nexus/`, byte for byte, with every relative path exactly as the
page had written it. The Host had rewritten nothing, which is the whole of what
a Plugin is promised.

Nexus was untouched at that point: its working tree had no change of any kind.
The proof came first, and the deletions came after.

## What nexus then did

Two pieces of work, both in the nexus repository, both done:

1. **An `mcp` executable.** Nexus ships one, so the Host starts it and the
   Index Page shows nexus as Running. Its Plugin Server answers `tools/list`
   with five tools: `list_skills`, `show_global_instructions`,
   `edit_global_instructions`, `update_skill` and `remove_skill`. Those are
   everything the Plugin Page can do.

2. **`web/app.js` calls `rpc`.** One address, and an MCP JSON-RPC request in
   the body, rather than a REST call per endpoint. The Run Token is gone from
   the path: the Host sets a cookie on the first navigation and the page
   carries nothing.

And then the step that cannot be undone: `scripts/lib/ui_server.py`,
`scripts/ui.sh` and the whole `windows/` directory are deleted, and the
`nexus ui` command with them. Nexus records that in its own ADR 0008, which
supersedes the three ADRs that are why it once owned a listener, a Run File and
a tray. Its suite went from 129 tests to 95: the thirty-four that went drove a
server nexus no longer owns, and the boundary they protected is tested here
now, through the Host's own HTTP surface.

## What this cost nexus

Nothing that a person sees. The Plugin Page is the page it always was, at a new
address. What it gained is a Plugin Server that any other Plugin could one day
call over the Tool Bus, and a Tray it did not have to write.

## What FirstMate learned

A Plugin is a directory, and nothing else is asked of it (ADR-0002). Nexus
became one without adding a manifest, a schema or a build step, and its page
kept every relative path it already had. A Plugin Page is a whole page: the
Index Page links to it and the browser goes there, and the Host puts no chrome
around it (ADR-0008). Moving between Plugins belongs to the Index Page and the
Tray, which is why the Tray lists them.
