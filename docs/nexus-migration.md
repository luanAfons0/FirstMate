# What remains in the nexus repository

FirstMate v1 proves itself against nexus: `~/.nexus` is registered as a Plugin
named `nexus`, and the Host serves its existing `web/` directory as a Plugin
Page with every relative path unchanged.

Nexus keeps its own server and its own tray throughout. Deleting them is the
last step of the migration, not part of v1, and a working tool is never broken
by the migration (stories 35 to 37).

## What v1 proved

Served from `~/.nexus/web/`, unchanged, with the Host running as a systemd
service:

| Address                        | Answer                                     |
| ------------------------------ | ------------------------------------------ |
| `/p/nexus/`                     | `index.html`, 3087 bytes, byte for byte    |
| `/p/nexus/app.css`              | 11637 bytes, byte for byte                 |
| `/p/nexus/app.js`               | 36094 bytes, byte for byte                 |
| `/p/nexus/vendor/marked.min.js` | 39903 bytes, byte for byte                 |

`scripts/lib/ui_server.py` and `windows/` are byte for byte what they were, and
the nexus working tree has no change of any kind.

## What remains, in the nexus repository

Two pieces of work, neither of which belongs to FirstMate:

### 1. Write nexus's `mcp` executable

Nexus ships no `mcp` file, so the Index Page shows it as having **no Plugin
Server**. Its page loads and its buttons reach nothing.

The Plugin Server is an ordinary MCP server over stdio, in any language the
shebang names. It exposes what `scripts/lib/ui_server.py` exposes today as
tools: listing skills, reading and writing the Global Instructions, installing,
updating and removing a skill, and relinking.

### 2. Point `web/app.js` at `/p/nexus/rpc`

Today `web/app.js` builds its own base address from the Run Token in the path:

```js
const BASE = location.pathname.replace(/^(\/t\/[0-9a-f]{32}\/).*$/, '$1');
const API = location.origin + BASE + 'api/';
```

Under the Host the path is `/p/nexus/`, which that expression leaves alone, so
`API` already resolves to `http://127.0.0.1:<port>/p/nexus/api/`. The shape is
right and the address is wrong: there is one address, `rpc`, and the body is an
MCP JSON-RPC request rather than a REST call per endpoint.

```js
const answer = await fetch('rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'list_skills', arguments: {} },
  }),
});
```

The token is gone from the path: the Host sets a cookie on the first navigation
and the page carries nothing. The header's `base-url`, the `Stop server` button
and the stopped-run panel all belong to nexus's own run and have no meaning
under the Host.

### And only then

Delete `scripts/lib/ui_server.py` and `windows/`, and the `nexus ui` command
with them. That is the irreversible step, and it happens after the replacement
is proven and not before.
