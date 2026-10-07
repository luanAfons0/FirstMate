@rem The Windows form of this fixture: server-only's server, which answers as
@rem server-only. The Host starts mcp.ts before it, so this one never answers.
@"%FIRSTMATE_NODE%" "%~dp0..\server-only\mcp" %*
