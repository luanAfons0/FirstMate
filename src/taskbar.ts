/**
 * The name Windows groups FirstMate's taskbar button by.
 *
 * A taskbar button is grouped by an Application User Model ID, and a program
 * that never sets one is grouped by the executable that runs it. FirstMate is
 * run by node.exe, so without this the taskbar shows Node's icon beside a
 * window whose own icon is already FirstMate's: the title bar is right and the
 * taskbar is wrong, and setting the window icon again does not help.
 *
 * The window is told its own identity and where its icon is, and Windows then
 * draws the button from that. There is no way to reach the shell's property
 * store from Node, so FirstMate asks PowerShell to do it, as it does for the
 * helpers that hold the Shortcuts (`hotkeys.ts`) and show the Notices
 * (`notice-helper.ts`).
 * Every value travels in the environment rather than spliced into the script,
 * so no value is ever read as code (#45).
 */
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * What this program is, to Windows. It names the button, and the Notices are
 * sent under it too, so that both say FirstMate.
 */
export const IDENTITY = 'LuanAfonso.FirstMate';

/** How long PowerShell has. It is one small thing and the window is already up. */
const TIMEOUT_MS = 20_000;

/**
 * The script, which is fixed text and reads its values from the environment.
 *
 * `System.AppUserModel.ID` is what the button is grouped by, and
 * `RelaunchIconResource` is the icon Windows draws for that group. Both live in
 * the same property set, at 5 and 3.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PropertyKey { public Guid fmtid; public uint pid;
  public PropertyKey(Guid g, uint p) { fmtid = g; pid = p; } }

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
  int GetCount(out uint c);
  int GetAt(uint i, out PropertyKey k);
  int GetValue(ref PropertyKey k, IntPtr pv);
  int SetValue(ref PropertyKey k, IntPtr pv);
  int Commit();
}

public static class Mark {
  [DllImport("shell32.dll")]
  static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid,
    [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
  [DllImport("ole32.dll")] static extern void PropVariantClear(IntPtr pv);

  // A PROPVARIANT holding a wide string: VT_LPWSTR is 31, and the pointer sits
  // at offset 8, after the type and its three reserved words.
  static IntPtr StringVariant(string value) {
    IntPtr pv = Marshal.AllocCoTaskMem(24);
    for (int b = 0; b < 24; b++) Marshal.WriteByte(pv, b, 0);
    Marshal.WriteInt16(pv, 0, 31);
    Marshal.WriteIntPtr(pv, 8, Marshal.StringToCoTaskMemUni(value));
    return pv;
  }

  public static int Apply(IntPtr hwnd, string id, string icon, string name) {
    Guid iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
    IPropertyStore store;
    int hr = SHGetPropertyStoreForWindow(hwnd, ref iid, out store);
    if (hr != 0) return hr;
    Guid g = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    uint[] pids = { 5, 3, 4 };
    string[] values = { id, icon, name };
    for (int i = 0; i < pids.Length; i++) {
      PropertyKey key = new PropertyKey(g, pids[i]);
      IntPtr pv = StringVariant(values[i]);
      int sr = store.SetValue(ref key, pv);
      PropVariantClear(pv);
      Marshal.FreeCoTaskMem(pv);
      if (sr != 0) { Marshal.ReleaseComObject(store); return sr; }
    }
    int cr = store.Commit();
    Marshal.ReleaseComObject(store);
    return cr;
  }
}
'@
$code = [Mark]::Apply(
  [IntPtr]::new([int64] $env:FIRSTMATE_WINDOW),
  $env:FIRSTMATE_IDENTITY,
  $env:FIRSTMATE_ICON + ',0',
  'FirstMate')
if ($code -ne 0) { throw ('0x{0:X8}' -f $code) }
`;

/**
 * Tell Windows what this window is, so that the taskbar draws FirstMate's mark.
 *
 * Call it before the window is first shown: the shell reads this when it makes
 * the button, and a button already made keeps what it read.
 *
 * It answers with nothing when it worked and a sentence when it did not. A
 * taskbar button with the wrong icon is a blemish and not a fault, so the
 * caller is free to carry on.
 */
export function nameTheWindow(handle: bigint, icon: URL): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return Promise.resolve('Windows draws this button, and this is not Windows.');
  }
  return new Promise((done) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      {
        env: {
          ...process.env,
          FIRSTMATE_WINDOW: handle.toString(),
          FIRSTMATE_IDENTITY: IDENTITY,
          FIRSTMATE_ICON: fileURLToPath(icon),
        },
        timeout: TIMEOUT_MS,
        windowsHide: true,
      },
      (fault, _stdout, stderr) => {
        if (fault === null) done(undefined);
        else done(stderr.trim() === '' ? fault.message : stderr.trim());
      },
    );
  });
}
