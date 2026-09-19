# The Tool Bus runs over the pipe the Host owns

A Plugin Server has to reach another Plugin's tools, and the obvious road is the one a Plugin Page already takes: a loopback HTTP request to `POST /p/<name>/rpc`. We chose the stdio pipe the Host already holds, because that pipe is the caller's identity. The Host spawned the process and owns both ends, so the calling Plugin Name comes from the connection and cannot be forged. Over HTTP the Host would have to be told who was calling, and being told means a port and a token in every Plugin's hands: a secret to leak, and a second thing to check on every call.

## Consequences

A Plugin Server that ships no HTTP client can use the Tool Bus. One JSON line out on stdout and one line back on stdin is the whole of it, which keeps the promise of ADR-0002: a Plugin is a convention, not a runtime to link against.

A Plugin Page cannot reach the Tool Bus at all. It holds no end of the pipe, and `POST /p/<name>/rpc` reaches a Plugin Server and never the Host, so ADR-0003 and ADR-0008 stand untouched. A Grant is between two Plugins, and opening a page in a browser opens none of it.

The pipe is now two-way, so each side numbers its own requests. An inbound message is read as a question whenever it names a method, and only then as an answer, because a Plugin Server's id 3 is not the Host's id 3. Two Plugins granted to each other would also call each other without end, so the Host counts the Plugins a chain has passed through and refuses past a small cap.
