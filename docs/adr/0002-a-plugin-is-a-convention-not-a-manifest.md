# A plugin is a convention, not a manifest

The Host has to know how to start a Plugin Server, and every comparable plugin platform answers this with a manifest file. We instead run the executable file `mcp` in the Plugin directory, over stdio, if it exists: the shebang decides the language, there is no schema to version, and the whole Plugin contract stays three sentences long.

## Considered Options

A one-field `firstmate.json`, and reusing MCP's own `mcpServers` JSON shape. The second is tempting because a third-party MCP server would drop in unchanged, but a two-line `mcp` shell script wraps any of them, so the convention buys the same result without owning a config format.
