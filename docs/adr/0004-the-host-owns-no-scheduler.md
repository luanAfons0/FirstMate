# The host owns no scheduler

FirstMate was first justified as a thing that runs work on a schedule with no agent present. Plugin one turned out to need no clock at all, so scheduling moved out of the Host and became a future Plugin like any other, leaving the Host as a shared runtime: process supervisor, static file server, RPC path, security boundary and Tray.

## Consequences

The real reason FirstMate exists is duplication, not autonomy. Nexus and the `daily` skill each hand-built the same local HTTP server, token, web folder and tray, and a third tool would have built a third.

A scheduler that is itself a Plugin can only work once one Plugin may call another Plugin's tools, so the Tool Bus is its prerequisite.
