# The host is TypeScript on Node

The Host is written in TypeScript on Node, although the two projects it generalises are Python and Shell. Plugin Pages are HTML, CSS and JavaScript, so a TypeScript Host puts the whole surface in one language, and the Host itself is only a process supervisor, an HTTP server and a JSON-RPC client.

## Considered Options

Python 3.13, which would have matched nexus's `ui_server.py` and the `daily` runtime. That argument does not survive: `ui_server.py` is being deleted and `daily` is abandoned, so there is nothing left to reuse.
