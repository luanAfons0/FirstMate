# The published package is built, the repository is not

ADR-0006 put the Host in TypeScript on Node, and Node 24 runs TypeScript with no build step. That is true of a clone and stays true. It cannot be true of a package on npm, because Node refuses to strip types anywhere beneath `node_modules`, and an installed FirstMate is beneath `node_modules`. Installing a packed tarball and running `npx firstmate` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Neither `--experimental-strip-types` nor `--experimental-transform-types` lifts that refusal; it is deliberate. So the package is compiled on its way out: publishing emits JavaScript, and nothing else in the project ever emits anything.

## Consequences

Development is unchanged, and this is the part to hold on to. A clone holds no built output. `node src/main.ts` still starts the Host, `node --test` still runs the suite against the source, and there is still no bundler, no transpiler and no watcher. The build lives on the publish path alone, so the only person who ever runs it is the one cutting a release. ADR-0006 is narrowed, not reversed: "no build step" now names the repository, which is where it was always true, rather than every copy of FirstMate everywhere.

A local import in this project carries the `.ts` extension, because Node runs the TypeScript directly. Emitted JavaScript that still imports `./config.ts` resolves to nothing, so the compiler has to rewrite those extensions as it emits. This is the one compiler option the whole arrangement rests on.

The trade is small, and it is on the record: 51,124 bytes of JavaScript against 57,000 bytes of source, and a command line that starts in 27.6 ms rather than 64.6 ms, because type stripping is paid again at every process start. This is a type strip, not an optimiser and not a bundle. The emitted code is otherwise the same code.

The Plugin contract is untouched. A Plugin is still a directory, with a `web/` directory served byte for byte and an executable `mcp` the Host runs under its own shebang (ADR-0002). Nothing belonging to a Plugin is ever compiled, and a Plugin author sees none of this.
