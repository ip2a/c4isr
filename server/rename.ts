import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";
import { stat, readFile, realpath } from "node:fs/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { t } from "../shared/text";
import { renameAgentRpc } from "../shared/rename";

/**
 * 更改标题 runs through the host install's own CLI (`paseo agent update <id> --name`): the SDK
 * handle has no setter, and a raw DaemonClient would mean vendoring the client's transport. The
 * finder mirrors how the daemon finds itself (`resolvePaseoCliExecutablePath`): `PASEO_CLI` (the
 * desktop sets it), then `paseo` on `PATH`, then the CLI installed next to this daemon — a CLI of
 * another version belongs to some other install and is left alone. Found once, kept.
 */

type CliCommand = { command: string; args: string[] };

let cliPromise: Promise<CliCommand | null> | null = null;

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && (info.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** The version (and, with `name`, the package name) of the nearest package.json above `file`. */
async function manifestVersion(file: string, name?: string): Promise<string | null> {
  let directory = dirname(await realpath(file).catch(() => file));
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: unknown; version?: unknown };
      if (name === undefined || manifest.name === name) return typeof manifest.version === "string" ? manifest.version : null;
    } catch {
      // No package.json here, or not one we can read: keep climbing.
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * The CLI installed with the daemon running this plugin: the plugin process runs from
 * `@getpaseo/server`'s `plugin-process.js` (`process.argv[1]`), so `@getpaseo/cli` resolves from
 * there in an npm prefix or global install. The bin is a Node script: it runs with this process's
 * Node, as its shebang would run it with whichever `node` is first on `PATH`.
 */
async function hostCli(entry: string | undefined): Promise<CliCommand | null> {
  if (!entry) return null;
  let bin: string;
  try {
    bin = createRequire(entry).resolve("@getpaseo/cli/bin/paseo");
  } catch {
    return null;
  }
  try {
    if (!(await stat(bin)).isFile()) return null;
  } catch {
    return null;
  }
  const cli = await manifestVersion(join(dirname(bin), "..", "package.json"));
  const daemon = await manifestVersion(entry, "@getpaseo/server");
  if (!cli || !daemon || cli !== daemon) return null;
  // The bin's own shebang flag, where this Node knows it.
  const quiet = process.allowedNodeEnvironmentFlags.has("--disable-warning") ? ["--disable-warning=DEP0040"] : [];
  return { command: process.execPath, args: [...quiet, bin] };
}

/** `paseo` on `PATH`, then `PASEO_CLI` (Paseo desktop sets it), then the CLI installed with this daemon.
 *  PATH first: the macOS desktop wrapper hands its arguments to the running GUI and exits 0 without
 *  performing CLI commands, so trusting `PASEO_CLI` renames nothing while reporting success. */
async function findCli(): Promise<CliCommand | null> {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(entry || process.cwd(), "paseo");
    if (await isExecutableFile(candidate)) return { command: candidate, args: [] };
  }
  const configured = process.env.PASEO_CLI;
  if (configured && await isExecutableFile(configured)) return { command: configured, args: [] };
  return hostCli(process.argv[1]);
}

function resolveCli(): Promise<CliCommand | null> {
  if (!cliPromise) cliPromise = findCli().catch(() => null);
  return cliPromise;
}

async function rename(agentId: string, title: string): Promise<{ ok: boolean; error: string | null }> {
  const cli = await resolveCli();
  if (!cli) return { ok: false, error: t("serverRename.m001") };
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(cli.command, [...cli.args, "agent", "update", agentId, "--name", title, "--json"], { timeout: 10_000 }, (error, out) => error ? reject(error) : resolve(String(out ?? "")));
    });
    // A working CLI prints the update as JSON; a wrapper that handed the command to a GUI and
    // exited without doing it stays silent. Silence is a failure, not a success.
    return stdout.trim() ? { ok: true, error: null } : { ok: false, error: t("serverRename.m003") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message.includes("timed out") ? t("serverRename.m002") : message };
  }
}

export function registerRename(server: PluginServerContext): void {
  server.handle(renameAgentRpc, async ({ agentId, title }) => rename(agentId, title));
}
