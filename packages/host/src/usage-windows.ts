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
 * that what it prints is read the same in every language Windows speaks.
 * One PowerShell stays open while readings keep coming, and prints the table
 * again each time it is asked.
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
 * How long a PowerShell stays open with no reading to answer. The Process
 * View asks every 2 seconds while it is shown, so a PowerShell lives while it
 * is shown and ends a few seconds after it closes or the window hides.
 */
const IDLE_MS = 5_000;

/** The line the script prints after each reading, so the Host knows it is whole. */
const DONE = 'done';

/** The start of the line the script prints for a reading that failed, before why. */
const FAILED = 'failed ';

/**
 * A PowerShell that reads the processes once for each line it is given, and
 * ends when its input ends, so that it does not outlive the Host. Each
 * reading prints every process as one line: PID, parent PID, start (a file
 * time, in 100 ns since 1601), CPU time (in 100 ns) and private working set
 * (in bytes, empty when the performance data has no such process), and then
 * a line that says it is done. The System Idle Process has no start, so it
 * starts at zero. A reading that fails says why on one line instead.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Read-Table {
  $private = @{}
  foreach ($one in Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess,WorkingSetPrivate) {
    $private[[uint32]$one.IDProcess] = $one.WorkingSetPrivate
  }
  foreach ($one in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,UserModeTime,KernelModeTime) {
    $start = if ($null -eq $one.CreationDate) { 0 } else { $one.CreationDate.ToFileTimeUtc() }
    '{0} {1} {2} {3} {4}' -f $one.ProcessId, $one.ParentProcessId, $start, ($one.UserModeTime + $one.KernelModeTime), $private[[uint32]$one.ProcessId]
  }
}
while ($null -ne [Console]::In.ReadLine()) {
  try {
    foreach ($line in @(Read-Table)) { [Console]::Out.WriteLine($line) }
  } catch {
    [Console]::Out.WriteLine('${FAILED}' + ($_.Exception.Message -replace '\\s+', ' '))
  }
  [Console]::Out.WriteLine('${DONE}')
  [Console]::Out.Flush()
}
`;

/** A PowerShell that stays open between readings. */
type Shell = {
  /** The lines of one reading, or a failure that says why in a sentence. */
  ask(): Promise<string>;
  /** End the PowerShell, and resolve when it has ended. */
  close(): Promise<void>;
  /** Whether it has ended, by itself or by `close`. */
  readonly ended: boolean;
};

/**
 * The reader of this machine's processes, through PowerShell. One PowerShell
 * answers every reading while they keep coming, because starting one takes
 * most of a second, and it ends when no reading asked for a few seconds, or
 * when the Host stops. Only that end is timed: the Host reads Usage when
 * asked, and never on a timer (ADR-0004, ADR-0032). A PowerShell that ended
 * or failed is not asked again: the next reading starts another.
 */
export function windowsReader(): ProcessReader {
  let shell: Shell | undefined;
  let idle: NodeJS.Timeout | undefined;
  /** The readings asked and not answered yet: an idle PowerShell has none. */
  let asked = 0;
  /** Whether the Host stopped, after which no PowerShell starts. */
  let stopped = false;

  const end = async (): Promise<void> => {
    clearTimeout(idle);
    idle = undefined;
    const was = shell;
    shell = undefined;
    await was?.close();
  };

  /** One reading from the open PowerShell, or from a new one when none is open. */
  const ask = async (): Promise<string> => {
    if (stopped) throw new Error('the Host is stopping.');
    if (shell?.ended === true) shell = undefined;
    const fresh = shell === undefined;
    shell ??= openPowerShell();
    const mine = shell;
    try {
      return await mine.ask();
    } catch (fault) {
      // A PowerShell that failed once may be stuck, and one that died while
      // it waited may not be known as dead yet: another starts, once.
      if (shell === mine) await end();
      if (fresh) throw fault;
      return ask();
    }
  };

  return {
    async read() {
      clearTimeout(idle);
      idle = undefined;
      asked += 1;
      try {
        return tableOf(await ask());
      } finally {
        asked -= 1;
        if (asked === 0 && shell !== undefined) {
          // The timer only ends the PowerShell; it never reads.
          idle = setTimeout(() => void end(), IDLE_MS).unref();
        }
      }
    },
    close() {
      stopped = true;
      return end();
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

/** Start a PowerShell that reads the processes each time it is asked. */
function openPowerShell(): Shell {
  const child = spawn(
    POWERSHELL,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64'),
    ],
    // The App has no console, and a PowerShell would open one on the screen.
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  /** Why it ended, once it has. */
  let gone: Error | undefined;
  /** The reading it is asked for now. */
  let waiting: { done(text: string): void; fail(fault: Error): void } | undefined;
  /** Asks wait their turn, as the PowerShell answers one at a time. */
  let turn: Promise<unknown> = Promise.resolve();
  let lines: string[] = [];
  let partial = '';
  let said = '';
  let ended: () => void = () => undefined;
  const closed = new Promise<void>((done) => (ended = done));

  const end = (why: Error): void => {
    if (gone !== undefined) return;
    gone = why;
    waiting?.fail(why);
    ended();
  };

  // A PowerShell that could not start, or has ended, refuses its input; how it
  // ended is what it says.
  child.stdin.on('error', () => undefined);
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    const read = (partial + chunk).split(/\r?\n/);
    partial = read.pop() ?? '';
    for (const line of read) {
      if (line !== DONE) {
        lines.push(line);
        continue;
      }
      const failed = lines.find((one) => one.startsWith(FAILED));
      const text = lines.join('\n');
      lines = [];
      if (failed === undefined) waiting?.done(text);
      else waiting?.fail(new Error(couldNotRead(failed.slice(FAILED.length))));
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    // Its first words say why it ended; the rest is not kept.
    if (said.length < 1_000) said += chunk;
  });
  child.once('error', (cause: NodeJS.ErrnoException) => {
    end(
      new Error(
        cause.code === 'ENOENT'
          ? `PowerShell is not on the PATH, and Usage on Windows is read through it.`
          : `PowerShell could not be run: ${cause.message}.`,
        { cause },
      ),
    );
  });
  child.once('close', (code) => {
    // PowerShell may say it in CLIXML, which is no sentence: then the exit code says it.
    const first = said
      .split(/\r?\n/)
      .find((line) => line.trim() !== '' && !line.startsWith('#<') && !line.startsWith('<'));
    end(new Error(couldNotRead(first ?? `it exited ${code}`)));
  });

  const answer = (): Promise<string> =>
    new Promise((done, fail) => {
      if (gone !== undefined) {
        fail(gone);
        return;
      }
      const late = setTimeout(() => {
        waiting?.fail(new Error(`PowerShell did not read the processes in ${ANSWER_MS / 1000} s.`));
        child.kill();
      }, ANSWER_MS);
      waiting = {
        done(text) {
          clearTimeout(late);
          waiting = undefined;
          done(text);
        },
        fail(fault) {
          clearTimeout(late);
          waiting = undefined;
          fail(fault);
        },
      };
      child.stdin.write('\n');
    });

  return {
    ask() {
      const mine = turn.then(answer);
      turn = mine.catch(() => undefined);
      return mine;
    },
    close() {
      if (gone === undefined) child.kill();
      return closed;
    },
    get ended() {
      return gone !== undefined;
    },
  };
}

/** The sentence for a reading PowerShell could not make, from what it said. */
function couldNotRead(why: string): string {
  return `PowerShell could not read the processes: ${why.trim().replace(/\.$/, '')}.`;
}
