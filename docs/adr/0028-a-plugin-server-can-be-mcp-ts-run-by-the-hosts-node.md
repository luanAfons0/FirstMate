# A Plugin Server can be mcp.ts, run by the Host's own Node

This amends ADR-0002 and ADR-0019. A Plugin Server was an executable `mcp` whose shebang picks the language, and on Windows `mcp.exe` or `mcp.cmd` (ADR-0019). A Node Plugin then needed three files to run on every system: the code, `mcp`, and `mcp.cmd`, which only hands the code to `FIRSTMATE_NODE`. An operator with nothing but the App installed has a Node all the same: the App runs as Node (ADR-0020), and that Node strips TypeScript's types. So a Plugin can ship its Plugin Server as `mcp.ts` or `mcp.js`, and the Host runs it with its own Node. One file runs on Linux and on Windows. The spec is issue #194.

## The order

In a `local` Place the Host looks, in this order, and starts the first file it finds:

1. `mcp.ts`
2. `mcp.js`
3. the forms that exist today: `mcp` on Linux; `mcp.exe`, then `mcp.cmd`, on Windows.

A Node file is started as the Host's Node, the one it names in `FIRSTMATE_NODE`, with the file's name as its one argument, in the Plugin directory, and with no shell. Under the App `ELECTRON_RUN_AS_NODE=1` is set, as it already is for every Plugin Server. It ends as every other Plugin Server on that system ends: stdin closed, then `SIGTERM` on Linux, and on Windows the whole tree after the same grace. A Plugin's own tests start it the same way: `process.execPath` with `mcp.ts`, in the Plugin directory, with no shell.

A Plugin may still ship `mcp` and `mcp.cmd` beside `mcp.ts`, for a 1.x Host or a `wsl` Place. The Node form wins wherever the Host looks for it.

## The wsl Place

A `wsl` Place is unchanged (ADR-0021): the Host starts `./mcp` inside the distribution, and the Host's Node, a Windows program, is not handed across. A Plugin there that ships the Node form and no `mcp` is Stopped, with one sentence that says a `wsl` Place starts `mcp`. It is a Plugin Server all the same, so the Plugin is not one that ships none.

## Considered Options

Read the shebang of `mcp` on Windows, and start Node when it names Node. ADR-0019 already refused a shebang table, and the file still could not be TypeScript without a loader.

A field in a manifest that names the file to start. ADR-0002 refused a manifest. A fixed list of file names keeps the contract a convention.

`mcp.mjs` and `mcp.cjs` as well. Two forms are enough: `mcp.js` takes its module kind from the Plugin's own `package.json`, and each name added is one more place a reader must look.

## Consequences

A Node Plugin ships one file, and runs on every system the App runs on, with no Node of its own and no build step.

The Node form runs on the Host's Node, whatever version that is. Under the App it is the App's Node; run from a clone, it is the Node that runs `packages/host/src/main.ts`. A Plugin that needs another Node still ships `mcp`.

The Host reads no code of a Plugin and runs no `npm install`: a Plugin's dependencies are its own, as its data is (ADR-0005).
