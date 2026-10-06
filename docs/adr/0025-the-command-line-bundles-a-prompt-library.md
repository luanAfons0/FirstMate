# The command line bundles a prompt library

`setup` asked the operator to type numbers from a list, over `node:readline`. The prompt module said why: a prompt library needs a raw TTY, a black-box test cannot drive one, and the project took one dependency only, the 1.x window (ADR-0011). ADR-0011 is superseded (ADR-0020), and the window library is gone (ADR-0024), so that reason no longer holds.

The command line now asks with `@clack/prompts` on a terminal: a list to tick for the Official Plugins and the Grants, a list to pick one from for a Place and a Shortcut's Plugin, yes or no with the default shown, and text with its default shown. `setup` opens with a title and closes with its summary in the same frame. Clack is small, has few dependencies of its own, and has the select, the multi-select, the spinner and the progress bar this command line wants, so one library covers all of them.

## Rules

- `@clack/prompts` is a devDependency of `apps/cli`, and the tsdown bundle carries it and every package under it. The published manifest still has no `dependencies`, so `npx` pulls nothing else. A test proves that the bundle imports nothing but Node's own modules and its own files.
- The clack form is chosen only when both stdin and stdout are a TTY. Anywhere else the `node:readline` form asks, one answer per line, exactly as before: the same questions, the same numbered lists, the same refusals, and the same stop when the input ends early. A script that pipes answers into `setup` sees no change.
- Both forms are one interface: text, confirm, choose and close. `setup` asks through it and does not know which form it has, except to frame itself on a terminal.
- A refused answer is asked again with the sentence the plain command gives, in both forms. Ctrl-C stops at once in both, and keeps what finished.
- The Host takes no dependency. Clack is the command line's alone.

## Considered Options

Keep `node:readline` alone. It works, but it is the reason `setup` asks for numbers, and the spinner and the progress bar would each be code of our own.

Inquirer, or Enquirer. Both are larger, with more dependencies under them, and neither gives a spinner and a progress bar in the same look.

Drive the clack form in the test suite through a pseudo-terminal. Node has no pseudo-terminal of its own, so it would need a native dependency in the tests, or `script` from util-linux, which Windows CI does not have. The suite's one seam stays the pipe.

## Consequences

The suite proves the piped form, which every `setup` test already drives, and that the bundle loads and runs `setup`. It cannot see the arrow keys. A person checks the clack form by hand, in Windows Terminal and in a WSL terminal, before a change to it is called done.

This amends the wording of ADR-0024: the package is still one bundled file with no runtime dependency, and that file now carries clack.
