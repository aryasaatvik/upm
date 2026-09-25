// `upm run <script>`: one package.json script, in a shell, with every `node_modules/.bin`
// above the project first on PATH. No pre/post scripts: what runs is what the file names.
// `upm exec` runs a package's bin through the same shell.
import { builtin } from "./builtin.ts";

export interface Script {
  /** The project directory, which is the script's cwd. */
  dir: string;
  /** The package.json the script came from. */
  file: string;
  name: string;
  command: string;
  /** Extra arguments, appended to the command quoted for the shell. */
  args: string[];
  pkg: { name?: string; version?: string };
}

/** The `scripts` map, or a clear error for one that is not a map of strings. */
export function readScripts(manifest: object, file: string): Record<string, string> {
  const { scripts } = manifest as { scripts?: unknown };
  if (scripts === undefined) return {};
  if (
    scripts === null ||
    typeof scripts !== "object" ||
    Array.isArray(scripts) ||
    Object.values(scripts).some((command) => typeof command !== "string")
  ) {
    throw Object.assign(new Error(`${file}: scripts is not a map of commands`), {
      code: "EMANIFEST",
    });
  }
  return { ...(scripts as Record<string, string>) };
}

/** `node_modules/.bin` of `dir` and of each directory above it, nearest first. */
export function binDirs(dir: string): string[] {
  const { path } = builtin;
  const out: string[] = [];
  for (let at = path.resolve(dir); ; at = path.dirname(at)) {
    out.push(path.join(at, "node_modules", ".bin"));
    if (path.dirname(at) === at) return out;
  }
}

/**
 * The script's environment: the parent's, plus PATH and the `npm_*` names tools read. The
 * running node's directory goes on PATH too, so `node` in a script is the node running upm.
 */
export function scriptEnv(
  script: Script,
  env: Record<string, string | undefined> = globalThis.process.env,
): Record<string, string | undefined> {
  return {
    ...withPath(binDirs(script.dir), env),
    INIT_CWD: globalThis.process.cwd(),
    npm_lifecycle_event: script.name,
    npm_lifecycle_script: script.command,
    npm_package_json: script.file,
    npm_package_name: script.pkg.name ?? "",
    npm_package_version: script.pkg.version ?? "",
  };
}

/** The parent's environment with `dirs`, then the running node's directory, first on PATH. */
export function withPath(
  dirs: string[],
  env: Record<string, string | undefined> = globalThis.process.env,
): Record<string, string | undefined> {
  // Windows spells it `Path`, and a second `PATH` key would be the one that is ignored.
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  const node = builtin.path.dirname(globalThis.process.execPath);
  const path = [...dirs, node, env[key]].filter(Boolean).join(builtin.path.delimiter);
  return { ...env, [key]: path };
}

const WIN = globalThis.process?.platform === "win32";

/** The command with its arguments appended, each quoted for the shell (and `batch`) to read. */
export function shellLine(command: string, args: string[], win = WIN, batch = false): string {
  return [command, ...args.map((arg) => quote(arg, win, batch))].join(" ");
}

/** One word, quoted for the shell that will run it. */
export function quote(arg: string, win = WIN, batch = false): string {
  return win ? quoteCmd(arg, batch) : quoteSh(arg);
}

function quoteSh(arg: string): string {
  if (/^[\w./:=@+,-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

/**
 * Two layers, as in npm. The inner quotes are for the program's own argv parser, where a
 * backslash is only special before a quote or at the end. cmd.exe reads the line first and
 * knows nothing of `\"`, so every character it acts on is then hidden behind a caret — and
 * `%`, which it expands before it sees carets, becomes an expression that expands to `%`.
 * A batch file's `%*` puts the arguments through cmd's carets once more, but not its `%`
 * expansion, so there every caret is doubled and `%` is not, as npm escapes for a `.cmd`.
 */
function quoteCmd(arg: string, batch: boolean): string {
  if (arg === "") return '""';
  const quoted = /[\s"]/.test(arg)
    ? `"${arg.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`
    : arg;
  const once = quoted.replaceAll(/[!^&()<>|"]/g, "^$&");
  return (batch ? once.replaceAll(/[!^&()<>|"]/g, "^$&") : once).replaceAll("%", "%%cd:~,%");
}

/**
 * The signals passed on to the shell. A terminal delivers SIGINT and SIGHUP to the whole
 * foreground group, the shell included, so passing those on as well would be a second Ctrl-C
 * — the one that makes a watcher quit instead of restart. Only where there is no terminal
 * can a signal have reached upm alone. SIGTERM is what a CI timeout or `docker stop`
 * sends, and it is always aimed at one process.
 */
function forwarded(): NodeJS.Signals[] {
  const tty = globalThis.process.stdin.isTTY;
  return tty ? ["SIGTERM"] : ["SIGTERM", "SIGINT", "SIGHUP"];
}

/** Run the script to completion, sharing this process's stdio. Resolves to its exit code. */
export async function runScript(script: Script): Promise<number> {
  return await runArgs(script.command, script.args, script.dir, scriptEnv(script));
}

/** `runShell` with `args` quoted onto `command`, whose first word is `word`: see `isBatch`. */
export async function runArgs(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  word?: string,
): Promise<number> {
  const shim = WIN && args.length > 0 && (await import("./shim.ts"));
  const batch = shim && shim.isBatch(word ?? shim.firstWord(command), cwd, env);
  return await runShell(shellLine(command, args, WIN, batch), cwd, env);
}

/**
 * Run a shell line to completion, sharing this process's stdio. Resolves to its exit code.
 * A forwarded signal reaches the shell, as with npm — not what the shell is waiting on, so
 * a `sleep` in a `;` list is left to finish alone.
 */
export async function runShell(
  line: string,
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<number> {
  const child = WIN
    ? builtin.child_process.spawn(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
        cwd,
        env,
        stdio: "inherit",
        windowsVerbatimArguments: true,
      })
    : builtin.child_process.spawn("sh", ["-c", line], { cwd, env, stdio: "inherit" });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const signals = forwarded();
  for (const signal of signals) globalThis.process.on(signal, forward);
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    // The shell's convention for a signal, so upm exits the way the command did.
    child.on("exit", (code, signal) => {
      for (const name of signals) globalThis.process.off(name, forward);
      resolve(code ?? 128 + (signal ? (builtin.os.constants.signals[signal] ?? 0) : 0));
    });
  });
}
