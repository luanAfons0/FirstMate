# The App holds the Mate, which runs the operator's own Agent

An operator who works in FirstMate had no way to ask an AI from the App. They left the window, opened a terminal, started `claude` or `codex`, and lost the place they were in. To come back to an older question, they found the session ID by hand. The operator already has an Agent on their own account, with its own login and its own plan, and FirstMate gave it no place in the window. The spec is issue #212.

## The decision

The Mate is a chat in the App's window, with the operator's own Agent: Claude Code or Codex. It runs the Agent's own program in the background, sends it the question on standard input, and shows the answer as the Agent's events arrive. FirstMate holds no model key and makes no network call of its own: the question goes to the operator's Agent, and to nothing else.

The Mate is the App's. The Host stays four things, a process supervisor, an HTTP server on loopback, a static file server and a JSON-RPC client, and it serves no Mate page and no Mate address. What the App and the terminal share is in `core`: one module that runs the Agent and gives back a stream of events (a part of the answer, done, failed, stopped) and a stop, and one module that keeps the Conversations. The App draws the Mate in views of its own, with its own preload. `firstmate ask` is the same Mate with no window, and it needs no running Host.

The Agent runs with the least it needs:

- From a list of words, with no shell. A `.cmd` form on Windows runs through cmd.exe and is handed nothing cmd.exe would read as its own, as a Plugin Server is (ADR-0019).
- With the question on standard input, never in an argument, so no shell or cmd.exe rule can change what it means.
- In its own non-interactive mode, with no tool approved: Claude gets no `--permission-mode`, so it edits no file and runs no command while nobody is asked. Codex runs as `codex exec` with `--sandbox read-only`, and a resume, which takes no `--sandbox`, sets `sandbox_mode=read-only` through its config, so it writes no file either.
- In the operator's home directory of its Place. In a `wsl` Place it runs inside the distribution, as a Plugin Server does there (ADR-0021): `wsl.exe -d <distribution> --cd <home> --exec <program>`, where `--exec` hands it its words with no shell between, as on this machine.
- As a process tree of its own, which a stop ends whole: the process group on Linux, `taskkill /T /F` on Windows.

The Conversations are FirstMate's own data, one file of JSON lines each in `conversations/` in the home directory, written for this user alone. The first line says which Agent answers, in which Place, and which Agent session the next message resumes; each later line is one message. The Agent's memory of a Conversation is its own session, which it resumes, and not a copy FirstMate sends again. They are not a Plugin's data, so ADR-0005 is unchanged. The Agent keeps its own session files, and FirstMate never touches them.

A new Conversation tells the Agent what FirstMate is before its first question: a short primer with FirstMate's words and the `firstmate` commands that only read, every Plugin of the Registry with its Place, its directory and its address, and the operator's own `mate.md` from the home directory. It goes on standard input, before the question and marked off from it, and not as a flag or a system prompt of one Agent, so it reaches Claude and Codex, on this machine and in a `wsl` Place, the same way, and holds nothing for a shell or cmd.exe to read. It is sent once: a Conversation that goes on resumes the Agent's session, which holds it already. The context is FirstMate's own data, the Registry and a file the operator writes, and never a Plugin's: no file of a Plugin is read for it, so ADR-0005 is unchanged, and the Host's token is hidden in it as in everything else.

## Why not a Plugin

A Plugin is how FirstMate gives a tool a page, and a chat could be one: an Official Plugin with a Plugin Page and a Plugin Server that runs `claude`. The operator refused it: a Plugin would be one more page to open, and then one would just as well open Claude's own app. The value is that the Mate is in the window, beside the Plugins, a key away from whichever one is shown.

## Why not the Host's

Every Plugin Page shares the Host's origin, so anything the Host serves to the Index Page, a Plugin Page can reach as well (ADR-0012). An address on the Host that starts the Agent, or a page that types into it, would let any Plugin drive the operator's Agent on the operator's account, and read every Conversation. In the App's own views, with the App's preload, the main process checks which view asked, as it does for the Settings View, and no Plugin Page holds a preload at all.

## Why the Agent's own program

A model key held by FirstMate would be a secret to keep, a bill to pay and a network call to make, and the operator already pays for an Agent that is logged in. Running that Agent's own program uses the login, the plan, the models and the defaults the operator already chose, and a new model works on the day the Agent knows it. The program's flags change from time to time; one module owns them, so a flag that changes is one change in one place.

## Considered Options

An Official Plugin, refused above.

A Mate the Host serves, on the Index Page or at an address of its own. Any Plugin Page could reach it, as said above.

A model API called by FirstMate, with a key in the settings file. It makes FirstMate keep a secret and call the network, and it ignores the Agent the operator already has.

## Consequences

The Mate needs the Agent installed and logged in, on the `PATH` FirstMate sees in its Place. When it is not, the Mate says so in one sentence the operator can act on: where it looked, in which Place, and to set `program`; or that the Agent is not logged in, with the command that logs it in. In a `wsl` Place that `PATH` is the one `wsl.exe` gives a command, which reads no profile, so the Agent is looked for there before it runs, and the refusal shows that `PATH`. Looking costs one more start of `wsl.exe`, and keeps a missing Agent from leaving a Conversation behind.

A `place` that names no Place is a damaged Mate setting, and `place remove` refuses the Place the Mate runs in, as it refuses a Place that holds a Plugin.

What the Agent can do is what its non-interactive mode allows with no tool approved. Tool approval in the window, and the Mate reaching each Plugin's tools, are left out of this decision; the second reverses a consequence of ADR-0005 and amends ADR-0009, and needs a decision of its own.

`firstmate ask` is the seam the tests drive the Mate through, with a fake Agent on `PATH`. The window has no automated test (ADR-0020).
