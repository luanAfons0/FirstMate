/**
 * The helper that shows Notices in Windows.
 *
 * Windows names a pop-up and draws its icon from the Application User Model ID
 * it is sent under, and it shows a pop-up only for an ID it knows. The webview
 * library sends every pop-up under PowerShell's ID and has no way to change
 * it, so a Notice shown through it says "Windows PowerShell" and wears
 * PowerShell's icon. This helper sends each Notice under FirstMate's own ID,
 * the one the window's taskbar button already carries, so that a Notice says
 * "FirstMate" and wears the mark.
 *
 * Windows knows the ID from one key under the current user:
 * `HKCU\Software\Classes\AppUserModelId\<ID>`, with the name and the icon. The
 * helper writes that key every time it starts, so the icon follows the program
 * wherever npm puts it. Nothing removes the key on its own; removing FirstMate
 * removes it by hand (see `docs/deploy.md`, "Windows: the Tray").
 *
 * It speaks in lines, as the Shortcut helper does (`hotkeys.ts`): one Notice
 * per line in on stdin, and one event per line out on stdout. When stdin
 * closes, it ends. Nothing is ever spliced into the script: the ID, the icon
 * and how many pop-ups to hold travel in the environment, and each text travels on stdin as base64, or as
 * `-` when it is empty (#45).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { IDENTITY } from './taskbar.ts';

/**
 * The helper, which is fixed text.
 *
 * Windows PowerShell cannot subscribe to a WinRT event itself, so each pop-up's
 * click and dismissal are bound to a small C# object that only writes a line.
 * Those events arrive on other threads, and the lock keeps two lines whole.
 * A click also lets any process take the foreground, because Windows gives that
 * right to the process that was clicked, and the window belongs to the Tray.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$key = 'HKCU:\\Software\\Classes\\AppUserModelId\\' + $env:FIRSTMATE_IDENTITY
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name DisplayName -Value 'FirstMate' -PropertyType String -Force |
  Out-Null
New-ItemProperty -Path $key -Name IconUri -Value $env:FIRSTMATE_ICON -PropertyType String -Force |
  Out-Null
Add-Type @'
using System;
using System.Runtime.InteropServices;

public class FirstMateNotice {
  static readonly object speaking = new object();
  [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int process);
  readonly string sequence;
  public FirstMateNotice(string sequence) { this.sequence = sequence; }
  public static void Say(string line) {
    lock (speaking) { Console.Out.WriteLine(line); Console.Out.Flush(); }
  }
  public void Activated(object sender, object args) {
    AllowSetForegroundWindow(-1);
    Say("clicked " + sequence);
  }
  public void Dismissed(object sender, object args) { Say("dismissed " + sequence); }
  public void Failed(object sender, object args) { Say("failed " + sequence); }
}
'@
# A WinRT type is named whole, on one line, or PowerShell cannot read it.
[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(
  $env:FIRSTMATE_IDENTITY)
$toast = 'Windows.UI.Notifications.ToastNotification'
# Each handler is made of the exact type its event asks for, read off the event.
# The method is passed as itself, not by name, because only then may a method
# that takes two objects stand for a handler that takes two WinRT types.
function Add-Heard($popUp, $heard, [string] $name) {
  $type = $popUp.GetType().GetEvent($name).EventHandlerType
  $method = $heard.GetType().GetMethod($name)
  [void]$popUp.('add_' + $name).Invoke([Delegate]::CreateDelegate($type, $heard, $method))
}
function Read-Text([string] $base64) {
  if ($base64 -eq '-') { return '' }
  [Security.SecurityElement]::Escape(
    [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($base64)))
}
# The last pop-ups shown are held, so that their handlers live as long as they
# can be clicked: in the corner, and then in the notification centre. The Tray
# answers a click for no more than these, so an older one is let go.
$held = [int] $env:FIRSTMATE_ON_SCREEN
$shown = New-Object System.Collections.ArrayList
[FirstMateNotice]::Say('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim().Split(' ')
  if ($parts.Length -ne 4 -or $parts[0] -ne 'show' -or $parts[1] -notmatch '^[0-9]+$') {
    [FirstMateNotice]::Say('unknown ' + $line)
    continue
  }
  try {
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>' +
      (Read-Text $parts[2]) + '</text><text>' + (Read-Text $parts[3]) +
      '</text></binding></visual></toast>')
    $popUp = New-Object $toast $xml
    $heard = New-Object FirstMateNotice $parts[1]
    foreach ($name in 'Activated', 'Dismissed', 'Failed') { Add-Heard $popUp $heard $name }
    $notifier.Show($popUp)
    [void]$shown.Add($popUp)
    if ($shown.Count -gt $held) { $shown.RemoveAt(0) }
    [FirstMateNotice]::Say('shown ' + $parts[1])
  } catch {
    $why = $_.Exception.Message -replace '\\s+', ' '
    [FirstMateNotice]::Say('failed ' + $parts[1] + ' ' + $why)
  }
}
`;

/**
 * How many shown Notices a click is still answered for. The helper holds this
 * many pop-ups and the Tray remembers this many, and both let the older go.
 */
export const ON_SCREEN = 20;

/** The running helper: a way to show one Notice, and a way to end it. */
export type NoticeHelper = {
  /**
   * Show one pop-up. It answers false when the helper has ended and shows
   * nothing, so that the caller can say it another way.
   */
  show(sequence: number, title: string, body: string): boolean;
  /** Close its stdin, which ends it. */
  stop(): void;
};

/** One line the helper wrote, read. */
export type NoticeEvent =
  | { readonly kind: 'ready' }
  | { readonly kind: 'shown' | 'clicked' | 'dismissed'; readonly sequence: number }
  | { readonly kind: 'failed'; readonly sequence: number; readonly reason: string }
  | { readonly kind: 'unknown'; readonly line: string };

/** Read one line the helper wrote. */
export function readNoticeEvent(line: string): NoticeEvent {
  const [word = '', number = '', ...rest] = line.trim().split(' ');
  if (word === 'ready' && number === '') return { kind: 'ready' };
  if (!/^[0-9]+$/.test(number)) return { kind: 'unknown', line };
  const sequence = Number(number);
  if (word === 'failed') {
    return { kind: 'failed', sequence, reason: rest.join(' ') || 'Windows gave no reason' };
  }
  if (rest.length === 0 && (word === 'shown' || word === 'clicked' || word === 'dismissed')) {
    return { kind: word, sequence };
  }
  return { kind: 'unknown', line };
}

/**
 * Start the helper, with the mark it registers as FirstMate's icon. Each line
 * it writes is handed to `heard`; `ended` is told once, with a sentence, if it
 * stops while it is still wanted.
 */
export function startNoticeHelper(
  icon: URL,
  heard: (line: string) => void,
  ended: (why: string) => void,
): NoticeHelper {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
    {
      env: {
        ...process.env,
        FIRSTMATE_IDENTITY: IDENTITY,
        FIRSTMATE_ICON: fileURLToPath(icon),
        FIRSTMATE_ON_SCREEN: String(ON_SCREEN),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
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
    show: (sequence, title, body) => {
      if (stopping || !child.stdin.writable) return false;
      child.stdin.write(`show ${sequence} ${base64(title)} ${base64(body)}\n`);
      return true;
    },
    stop: () => {
      stopping = true;
      child.stdin.end();
    },
  };
}

/** One text as one word on the line. An empty text would be no word at all. */
function base64(text: string): string {
  return text === '' ? '-' : Buffer.from(text, 'utf8').toString('base64');
}
