# Plugin pages reach their tools over same-origin HTTP

A Plugin Page reaches its own Plugin Server through `POST /p/<name>/rpc` on the Host, same-origin, rather than through an iframe and `postMessage`. Nearly every comparable host chose `postMessage` — VS Code webviews, browser extensions, Figma, and MCP Apps — so this deviation needs its reason recorded: the Tool Bus is server-side and needs an RPC path whatever we choose, and `postMessage` would mean maintaining two RPC surfaces instead of one.

## Consequences

The Host must defend a localhost HTTP API itself. That means binding `127.0.0.1` only, validating `Host` against an allowlist, validating `Origin` and `Sec-Fetch-Site`, rejecting a null origin, and carrying a token minted at startup. DNS rebinding against local services is exploited in the wild; Ollama, Vite, the MCP SDKs and NemoClaw have all shipped advisories for it.

A Plugin Page is trusted, because it is not sandboxed. This is consistent rather than lax: the Plugin Server beside it is an unrestricted subprocess, so sandboxing the page alone would protect nothing.

A UI written for MCP Apps will not drop into FirstMate unchanged.
