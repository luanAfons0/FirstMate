/**
 * Usage on Windows: every process from `Get-CimInstance Win32_Process`,
 * through PowerShell, with no dependency (ADR-0032).
 *
 * CPU is user plus kernel time, which Windows counts in units of 100 ns.
 * Memory is the private working set, the fair share on Windows: the pages a
 * process holds in memory that no other process shares. Win32_Process does not
 * say it, so the same script reads it from the process performance data, by
 * PID. Windows lets no process read another's environment, so no process here
 * names its Plugin: a row walks the tree from the process the Host started,
 * and the walk checks start times, so that a PID Windows gave again is not
 * counted (`treeOf`).
 *
 * The script prints one plain line per process, digits and spaces alone, so
 * that what it prints is read the same in every language Windows speaks. How
 * the script is run is the shell's job: one PowerShell per reading here, and
 * the reading reads the same lines from a PowerShell that stays open.
 */
import { spawn } from 'node:child_process';
import type { ProcessFacts, ProcessReader } from './process-table.ts';

/** The program that runs the script, found on PATH. */
const POWERSHELL = 'powershell.exe';

/** How long one run of the script may take before the reading fails. */
const ANSWER_MS = 10_000;

/** Windows counts CPU time in units of 100 ns: this many make a millisecond. */
const UNITS_PER_MS = 10_000;

/**
 * Every process as one line: PID, parent PID, start (a file time, in 100 ns
 * since 1601), CPU time (in 100 ns) and private working set (in bytes, empty
 * when the performance data has no such process). The System Idle Process has
 * no start, so it starts at zero.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$private = @{}
foreach ($one in Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess,WorkingSetPrivate) {
  $private[[uint32]$one.IDProcess] = $one.WorkingSetPrivate
}
foreach ($one in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,UserModeTime,KernelModeTime) {
  $start = if ($null -eq $one.CreationDate) { 0 } else { $one.CreationDate.ToFileTimeUtc() }
  '{0} {1} {2} {3} {4}' -f $one.ProcessId, $one.ParentProcessId, $start, ($one.UserModeTime + $one.KernelModeTime), $private[[uint32]$one.ProcessId]
}
`;

/** What runs the script and gives back what it printed, or fails with a sentence. */
type Shell = (script: string) => Promise<string>;

/**
 * The reader of this machine's processes, through PowerShell. Each reading
 * starts a PowerShell of its own, unless it is given a shell that stays open.
 */
export function windowsReader(shell: Shell = runPowerShell): ProcessReader {
  return {
    async read() {
      return tableOf(await shell(SCRIPT));
    },
  };
}

/**
 * The process table in the lines the script printed. A line that is not five
 * numbers is not a process; with no process at all, PowerShell said nothing
 * worth reading, and the reading fails.
 */
function tableOf(text: string): ProcessFacts[] {
  const table: ProcessFacts[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d+) (\d+) (\d+) (\d+) (\d*)$/.exec(line.trim());
    if (match === null) continue;
    const [, pid = '', parent = '', start = '', cpu = '', memory = ''] = match;
    table.push({
      pid: Number(pid),
      parent: Number(parent),
      // A file time is past what a number holds exactly, so it is kept in
      // milliseconds: a parent and its child still start in order.
      start: Number(BigInt(start) / BigInt(UNITS_PER_MS)),
      cpuMs: Number(cpu) / UNITS_PER_MS,
      memoryBytes: memory === '' ? null : Number(memory),
      plugin: null,
    });
  }
  if (table.length === 0) throw new Error('PowerShell gave no process table to read.');
  return table;
}

/** Run the script in a PowerShell of its own, and give back what it printed. */
function runPowerShell(script: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(
      POWERSHELL,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      // The App has no console, and a PowerShell would open one on the screen.
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    const late = setTimeout(() => {
      child.kill();
      fail(new Error(`PowerShell did not read the processes in ${ANSWER_MS / 1000} s.`));
    }, ANSWER_MS);
    child.once('error', (cause: NodeJS.ErrnoException) => {
      clearTimeout(late);
      fail(
        new Error(
          cause.code === 'ENOENT'
            ? `PowerShell is not on the PATH, and Usage on Windows is read through it.`
            : `PowerShell could not be run: ${cause.message}.`,
          { cause },
        ),
      );
    });
    child.once('close', (code) => {
      clearTimeout(late);
      if (code === 0) {
        done(Buffer.concat(out).toString('utf8'));
        return;
      }
      const said = Buffer.concat(err)
        .toString('utf8')
        .split(/\r?\n/)
        .find((line) => line.trim() !== '');
      const why = said === undefined ? `it exited ${code}` : said.trim().replace(/\.$/, '');
      fail(new Error(`PowerShell could not read the processes: ${why}.`));
    });
  });
}
