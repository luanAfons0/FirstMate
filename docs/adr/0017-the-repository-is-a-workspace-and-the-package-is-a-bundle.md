# The repository is a workspace, and the package is a bundle

This supersedes ADR-0010. FirstMate is going to be a desktop App and a command line that share one Host, and the two need their own dependencies and their own builds. So the repository is now a pnpm workspace with three packages, and the npm package is one bundle built from the third.

`packages/core` holds what the command line and the Host share: the Registry, the settings, the Shelf, the Shortcut form, the Official Plugins and the command logic with its refusal sentences. `packages/host` holds the Host. `apps/cli` is `@luan-afonso/firstmate`, and in 1.x it still carries the Host and the window. `core` imports nothing from `host`, and neither imports the window library. `core` and `host` are private and are never published: they reach the package only inside the bundle.

ADR-0010's reason still holds. Node refuses to strip types beneath `node_modules`, so a published FirstMate has to be JavaScript. What changes is that a type strip is no longer enough. A file of `apps/cli` that imports `@firstmate/core/registry` names a package that npm will never hold, so the package has to carry that code inside it. `tsdown` bundles `apps/cli` into `dist/`, with `core` and `host` inlined and `@webviewjs/webview` left outside as the dependency it is.

## Considered Options

Publish `core` and `host` as packages of their own, so a type strip of each would do. Three packages on npm for one program, each with a version a person could install alone, for code nobody else should import.

Keep `tsc` and import across packages by relative path. It works until the day a package moves, and it lies about where the line between the packages is.

Turbo, or another task runner over the workspace. Three packages and one build do not need one.

## Consequences

Development is unchanged in the part that matters. A clone holds no built output. `node packages/host/src/main.ts` starts the Host, `node apps/cli/src/cli.ts` runs the command line, and `node --test` runs the suite against the source. Node follows the workspace link out of `node_modules` to the real file, so the source of a linked package is not beneath `node_modules` and Node strips its types as it does any other.

The build lives on the publish path alone. `prepack` runs it, so packing always builds and a package can never be stale against the source. `pnpm pack` writes the tarball, because only pnpm rewrites `workspace:` to a version, and npm publishes that tarball, because trusted publishing over OIDC is npm's own. Every package carries one version, and the release refuses a tag that disagrees with any of them.

The bundle has two entries, `cli.js` and `main.js`, so that the Host's entry point sits beside the command line in the build as `apps/cli/src/main.ts` sits beside `cli.ts` in a clone. The service unit names `main`, and the Tray finds `cli` beside it, so neither had to change.

The window library stays a dynamic import, in the one chunk that `firstmate desktop` loads, so every other command still runs where its native binary will not load (ADR-0011). The package test reads the bundle and proves it. A build test boots the built Host and drives it over HTTP, through the same helper as every other test.

The trade, measured on the day it was made: 224,035 bytes of JavaScript in five files against 295,267 bytes of source, and `firstmate list` in 31 ms from the bundle against 94 ms from the source.

The Plugin contract is untouched. Nothing belonging to a Plugin is ever built.
