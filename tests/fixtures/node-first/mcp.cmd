@rem The Windows form of this fixture. The Host starts mcp.ts before it, so
@rem this one must never run: if it does, it ends at once, and the Plugin is
@rem Stopped.
@echo node-first: mcp.cmd ran, and mcp.ts should have won 1>&2
@exit /b 1
