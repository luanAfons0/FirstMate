# Plugins are MCP servers in a directory

A Plugin needs a way to expose what it can do and a way to ship its own interface, and neither in-process modules nor a home-grown protocol gives both. We chose a directory that may hold a Plugin Page and a Plugin Server, where the Plugin Server is an ordinary MCP server: the process boundary, the capability manifest and the language independence are already specified, and third-party plugins work by default.

## Consequences

A FirstMate Plugin is more than an MCP server. A plain MCP server taken from the ecosystem runs headless and has no Plugin Page, so the two are not interchangeable and MCP servers are second-class here.
