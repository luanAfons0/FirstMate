/**
 * The helper that holds the Shortcuts in Windows.
 *
 * A Shortcut works in all of Windows, so the Tray asks Windows for exactly the
 * keys that were bound, with `RegisterHotKey`, and is told only when one of
 * them is pressed. It never sees any other key. A global keyboard hook would
 * see every key the operator types, and an FFI library would be a second
 * dependency, so neither is used: a small PowerShell process owns the message
 * loop instead, as the Tray already asks PowerShell for the taskbar button
 * (ADR-0011, ADR-0013).
 *
 * It speaks in lines. One command per line goes in on stdin, and one event per
 * line comes out on stdout; `desktop-state.ts` writes the one and reads the
 * other, so this file only starts the process and carries the lines. When stdin
 * closes, the helper releases every key and ends, so a Tray that dies never
 * leaves a key held.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * The helper, which is fixed text. Nothing is ever spliced into it: every
 * value arrives later, on stdin, as data (#45).
 *
 * `RegisterHotKey` with no window ties a key to the thread that registered
 * it, so the one thread that runs the message loop does all the registering.
 * A second thread reads stdin, queues each line, and wakes the loop with a
 * thread message. A press also lets any process take the foreground, because
 * Windows gives that right to the process that got the key, and the Popup
 * belongs to the Tray and not to the helper.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class FirstMateShortcuts {
  [StructLayout(LayoutKind.Sequential)]
  struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam;
    public IntPtr lParam; public uint time; public int x; public int y; }

  [DllImport("user32.dll", SetLastError = true)]
  static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);
  [DllImport("user32.dll", SetLastError = true)]
  static extern bool UnregisterHotKey(IntPtr hwnd, int id);
  [DllImport("user32.dll")]
  static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")]
  static extern bool PeekMessage(out Msg msg, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")]
  static extern bool PostThreadMessage(uint thread, uint msg, UIntPtr w, IntPtr l);
  [DllImport("user32.dll")]
  static extern bool AllowSetForegroundWindow(int process);
  [DllImport("kernel32.dll")]
  static extern uint GetCurrentThreadId();

  const uint WM_HOTKEY = 0x0312;
  const uint WM_QUIT = 0x0012;
  const uint WM_APP = 0x8000;
  const uint MOD_NOREPEAT = 0x4000;
  const int ERROR_HOTKEY_ALREADY_REGISTERED = 1409;
  const int ASFW_ANY = -1;

  static readonly Dictionary<string, int> ids = new Dictionary<string, int>();
  static readonly Dictionary<int, string> names = new Dictionary<int, string>();
  static int next = 1;

  static void Say(string line) { Console.Out.WriteLine(line); Console.Out.Flush(); }

  public static void Run() {
    uint loop = GetCurrentThreadId();
    Msg msg;
    // A thread has no message queue until it asks for one, and a message posted
    // to a thread with none is lost.
    PeekMessage(out msg, IntPtr.Zero, 0, 0, 0);
    var queue = new ConcurrentQueue<string>();
    var reader = new Thread(() => {
      string line;
      while ((line = Console.In.ReadLine()) != null) {
        queue.Enqueue(line);
        PostThreadMessage(loop, WM_APP, UIntPtr.Zero, IntPtr.Zero);
      }
      PostThreadMessage(loop, WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
    });
    reader.IsBackground = true;
    reader.Start();
    Say("ready");

    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) {
      if (msg.message == WM_HOTKEY) {
        string keys;
        if (names.TryGetValue((int) msg.wParam.ToUInt32(), out keys)) {
          AllowSetForegroundWindow(ASFW_ANY);
          Say("pressed " + keys);
        }
      } else if (msg.message == WM_APP) {
        string line;
        while (queue.TryDequeue(out line)) Obey(line);
      }
    }
    foreach (int id in names.Keys) UnregisterHotKey(IntPtr.Zero, id);
  }

  static void Obey(string line) {
    string[] parts = line.Trim().Split(' ');
    if (parts.Length == 4 && parts[0] == "register") {
      string keys = parts[1];
      if (ids.ContainsKey(keys)) { Say("registered " + keys); return; }
      uint modifiers, key;
      if (!UInt32.TryParse(parts[2], out modifiers) || !UInt32.TryParse(parts[3], out key)) {
        Say("unknown " + line);
        return;
      }
      int id = next++;
      if (RegisterHotKey(IntPtr.Zero, id, modifiers | MOD_NOREPEAT, key)) {
        ids[keys] = id;
        names[id] = keys;
        Say("registered " + keys);
      } else {
        int code = Marshal.GetLastWin32Error();
        Say("refused " + keys + " " + (code == ERROR_HOTKEY_ALREADY_REGISTERED
          ? "another program holds it"
          : new Win32Exception(code).Message.Replace("\\r", " ").Replace("\\n", " ")));
      }
    } else if (parts.Length == 2 && parts[0] == "release") {
      int id;
      if (!ids.TryGetValue(parts[1], out id)) return;
      UnregisterHotKey(IntPtr.Zero, id);
      ids.Remove(parts[1]);
      names.Remove(id);
      Say("released " + parts[1]);
    } else {
      Say("unknown " + line);
    }
  }
}
'@
[FirstMateShortcuts]::Run()
`;

/** The running helper: a way to send it one line, and a way to end it. */
export type Hotkeys = {
  /** Send one command. A helper that has ended takes nothing. */
  send(line: string): void;
  /** Close its stdin, which releases every key and ends it. */
  stop(): void;
};

/**
 * Start the helper. Each line it writes is handed to `heard`; `ended` is told
 * once, with a sentence, if it stops while it is still wanted.
 */
export function startHotkeys(heard: (line: string) => void, ended: (why: string) => void): Hotkeys {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let stopping = false;
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (said += chunk));
  createInterface({ input: child.stdout }).on('line', (line) => heard(line.trim()));
  child.stdin.on('error', () => {
    // A helper that has ended closes its end of the pipe. The exit says why.
  });

  const gone = (why: string): void => {
    if (stopping) return;
    stopping = true;
    ended(why);
  };
  child.once('error', (fault) => gone(fault.message));
  child.once('exit', (code) => {
    gone(said.trim() === '' ? `the helper ended with code ${code}` : said.trim());
  });

  return {
    send: (line) => {
      if (!stopping && child.stdin.writable) child.stdin.write(`${line}\n`);
    },
    stop: () => {
      stopping = true;
      child.stdin.end();
    },
  };
}
