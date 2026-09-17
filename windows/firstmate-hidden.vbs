' The launch shim: start a PowerShell script beside this file with no window
' at all.
'
' It exists for one reason: powershell.exe -WindowStyle Hidden still flashes a
' console for a fraction of a second, and that flash would land on every logon.
' WScript.Shell.Run with the window style 0 opens no window at any time.
'
' usage: firstmate-hidden.vbs <script.ps1> [arguments ...]
'
' It runs only what sits beside it - the first argument is reduced to a file
' name in this folder, and must be a .ps1 - and passes the rest through, so the
' machine-specific values live in the task or the shortcut that calls this shim
' and in no configuration file.

Option Explicit

Dim shell, files, here, script, command, i, argument

If WScript.Arguments.Count < 1 Then
  WScript.Echo "usage: firstmate-hidden.vbs <script.ps1> [arguments ...]"
  WScript.Quit 2
End If

Set files = CreateObject("Scripting.FileSystemObject")
here = files.GetParentFolderName(WScript.ScriptFullName)
script = files.BuildPath(here, files.GetFileName(WScript.Arguments(0)))

If LCase(Right(script, 4)) <> ".ps1" Then
  WScript.Echo "firstmate-hidden.vbs runs a .ps1 beside it, nothing else."
  WScript.Quit 2
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & script & """"

For i = 1 To WScript.Arguments.Count - 1
  argument = WScript.Arguments(i)
  ' Quote only what needs it: a quoted -Distro would reach PowerShell as a
  ' value rather than as the name of a parameter.
  If InStr(argument, " ") > 0 Then
    argument = """" & argument & """"
  End If
  command = command & " " & argument
Next

Set shell = CreateObject("WScript.Shell")
' 0: no window. True: wait, so that the process this shim starts is the one
' Windows watches.
shell.Run command, 0, True
