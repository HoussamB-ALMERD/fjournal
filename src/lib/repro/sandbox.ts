import "server-only";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { LIMITS, type Manifest } from "./manifest";

/**
 * Runs untrusted research code inside Docker. Only the worker process uses this: the web server
 * never executes anyone's code.
 *
 *  1. setup  — the image with the source archive copied in; extracts it and runs `setup` WITH network
 *              (to install dependencies), as root but with every capability dropped.
 *  2. commit — the result becomes a throwaway image.
 *  3. run    — `run` executes with NO network, as user nobody, capabilities dropped, no privilege
 *              escalation, memory/CPU/process limits, and a hard timeout.
 *  4. outputs — copied out with `docker cp`, which resolves paths inside the container; symlinks are
 *              refused, so code can't make the worker read files from the host.
 * Nothing on the host is mounted into any container. For production, run the worker on a dedicated
 * VM with egress filtering, and set FJOURNAL_SANDBOX_RUNTIME=runsc (gVisor) for kernel isolation.
 */

const LOG_LIMIT = 64_000;

export class SandboxError extends Error {}

type Exec = { code: number | null; out: string; timedOut: boolean; stdout: Buffer };

function docker(args: string[], { timeoutMs = 120_000, stdin, maxStdout = 0 }: { timeoutMs?: number; stdin?: Buffer; maxStdout?: number } = {}): Promise<Exec> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { windowsHide: true });
    let out = "";
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const keepTail = (s: string) => {
      out += s;
      if (out.length > LOG_LIMIT * 2) out = out.slice(-LOG_LIMIT);
    };
    p.stdout.on("data", (d: Buffer) => {
      if (maxStdout) {
        size += d.length;
        if (size <= maxStdout) chunks.push(d);
      } else keepTail(d.toString("utf8"));
    });
    p.stderr.on("data", (d: Buffer) => keepTail(d.toString("utf8")));
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new SandboxError(`Docker is not available: ${e.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (maxStdout && size > maxStdout) out += `\n[output larger than ${maxStdout} bytes]`;
      resolve({ code, out: out.slice(-LOG_LIMIT), timedOut, stdout: Buffer.concat(chunks) });
    });
    if (stdin) p.stdin.end(stdin);
    else p.stdin.end();
  });
}

export async function dockerAvailable(): Promise<string | null> {
  try {
    const r = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 15_000 });
    return r.code === 0 ? r.out.trim() : null;
  } catch {
    return null;
  }
}

const HARDENING = ["--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "512", "--memory", "4g", "--memory-swap", "4g", "--cpus", "2"];
const runtime = () => (process.env.FJOURNAL_SANDBOX_RUNTIME ? ["--runtime", process.env.FJOURNAL_SANDBOX_RUNTIME] : []);

/** Reads the single regular file from a `docker cp … -` tar stream. Anything else is refused. */
export function fileFromTar(tar: Buffer): Buffer | { problem: string } {
  if (tar.length < 512) return { problem: "not produced" };
  const header = tar.subarray(0, 512);
  const type = String.fromCharCode(header[156]);
  if (type === "2" || type === "1") return { problem: "is a link, which is not allowed" };
  if (type !== "0" && type !== "\0") return { problem: "is not a regular file" };
  const size = parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
  if (!Number.isFinite(size) || size < 0) return { problem: "could not be read" };
  if (size > LIMITS.outputBytes) return { problem: `is larger than ${LIMITS.outputBytes / 1e6} MB` };
  if (tar.length < 512 + size) return { problem: "was truncated" };
  return tar.subarray(512, 512 + size);
}

export type SandboxResult = {
  imageDigest: string | null;
  phase: "setup" | "run" | "done";
  exitCode: number | null;
  timedOut: boolean;
  log: string;
  setupSeconds: number;
  runSeconds: number;
  files: Map<string, Buffer | { problem: string }>;
};

export async function runInSandbox(archivePath: string, manifest: Manifest): Promise<SandboxResult> {
  const tag = randomBytes(6).toString("hex");
  const setupName = `fj-setup-${tag}`;
  const runName = `fj-run-${tag}`;
  const committed = `fjournal-repro:${tag}`;
  const files = new Map<string, Buffer | { problem: string }>();
  let log = "";
  const section = (title: string, text: string) => (log += `\n── ${title} ──\n${text.trim()}\n`);

  try {
    const pull = await docker(["pull", manifest.image], { timeoutMs: 15 * 60_000 });
    if (pull.code !== 0) throw new SandboxError(`Could not pull ${manifest.image}: ${pull.out.slice(-500)}`);
    const digest = (await docker(["image", "inspect", "--format", "{{index .RepoDigests 0}}", manifest.image])).out.trim() || null;

    // 1. setup (network on)
    const setupScript = [
      "set -e",
      "mkdir -p /work",
      "tar -xzf /tmp/fjournal-src.tar.gz -C /work --strip-components=1",
      "rm -f /tmp/fjournal-src.tar.gz",
      "cd /work",
      manifest.setup ?? "true",
      "chmod -R a+rwX /work",
    ].join("\n");
    const created = await docker(["create", "--name", setupName, ...HARDENING, ...runtime(), "-w", "/", manifest.image, "sh", "-c", setupScript]);
    if (created.code !== 0) throw new SandboxError(`Could not create the setup container: ${created.out.slice(-500)}`);
    const copied = await docker(["cp", archivePath, `${setupName}:/tmp/fjournal-src.tar.gz`]);
    if (copied.code !== 0) throw new SandboxError(`Could not copy the source in: ${copied.out.slice(-500)}`);
    let t0 = Date.now();
    const setup = await docker(["start", "-a", setupName], { timeoutMs: LIMITS.setupMinutes * 60_000 });
    const setupSeconds = (Date.now() - t0) / 1000;
    section(`setup (${setupSeconds.toFixed(0)} s, network on)`, setup.out);
    if (setup.timedOut || setup.code !== 0)
      return { imageDigest: digest, phase: "setup", exitCode: setup.code, timedOut: setup.timedOut, log, setupSeconds, runSeconds: 0, files };

    // 2. commit
    const commit = await docker(["commit", setupName, committed]);
    if (commit.code !== 0) throw new SandboxError(`Could not snapshot the environment: ${commit.out.slice(-500)}`);

    // 3. run (network off, unprivileged)
    const timeout = (manifest.timeout_minutes ?? 30) * 60_000;
    const rc = await docker([
      "create", "--name", runName, "--network", "none", "--user", "65534:65534", "-e", "HOME=/tmp",
      ...HARDENING, ...runtime(), "-w", "/work", committed, "sh", "-c", manifest.run,
    ]);
    if (rc.code !== 0) throw new SandboxError(`Could not create the run container: ${rc.out.slice(-500)}`);
    t0 = Date.now();
    const run = await docker(["start", "-a", runName], { timeoutMs: timeout });
    const runSeconds = (Date.now() - t0) / 1000;
    section(`run (${runSeconds.toFixed(0)} s, no network)`, run.out);
    if (run.timedOut) await docker(["kill", runName]).catch(() => null);

    // 4. outputs
    for (const o of manifest.outputs) {
      if (files.has(o.file)) continue;
      const cp = await docker(["cp", `${runName}:/work/${o.file}`, "-"], { maxStdout: LIMITS.outputBytes + 64 * 1024 });
      files.set(o.file, cp.code === 0 ? fileFromTar(cp.stdout) : { problem: "not produced" });
    }
    return { imageDigest: digest, phase: "done", exitCode: run.code, timedOut: run.timedOut, log, setupSeconds, runSeconds, files };
  } finally {
    await docker(["rm", "-f", setupName, runName]).catch(() => null);
    await docker(["rmi", "-f", committed]).catch(() => null);
  }
}

