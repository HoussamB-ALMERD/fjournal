/**
 * Proves the reproducibility sandbox isolates code on THIS machine. Run it on every worker host
 * before trusting it:  npm run sandbox:selftest
 * It runs small honest and hostile repositories through the real Docker sandbox. No database needed.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareOutput, parseManifest, type Manifest } from "../src/lib/repro/manifest";
import { dockerAvailable, runInSandbox, type SandboxResult } from "../src/lib/repro/sandbox";

let bad = 0;
const ok = (c: boolean, m: string) => {
  if (!c) bad++;
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function archive(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fj-selftest-"));
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(root, "repo", name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  const t = spawnSync("tar", ["-czf", "src.tar.gz", "repo"], { cwd: root });
  if (t.status !== 0) throw new Error(`tar failed: ${t.stderr}`);
  return path.join(root, "src.tar.gz");
}

function manifest(outputs: object[], extra: object = {}): Manifest {
  const p = parseManifest(JSON.stringify({ version: 1, image: "python:3.12-slim", run: "python main.py", timeout_minutes: 2, outputs, ...extra }));
  if (!p.ok) throw new Error(p.errors.join(" "));
  return p.value;
}

const fileOf = (r: SandboxResult, f: string) => {
  const v = r.files.get(f);
  return Buffer.isBuffer(v) ? v : null;
};

if (!(await dockerAvailable())) {
  console.error("Docker engine not reachable — start Docker and try again.");
  process.exit(1);
}
console.log("Running sandbox self-test (pulls python:3.12-slim on first run)…\n");

// 1. Honest code: dependencies from setup are available; the run has no network and no root.
let m = manifest([{ claim: "n", file: "out/metrics.json", json: "n", reported: 1000 }], { setup: "pip install --quiet --no-cache-dir tomli==2.0.1" });
let r = await runInSandbox(archive({
  "main.py": `
import json, os, socket
os.makedirs("out", exist_ok=True)
json.dump({"n": 1000}, open("out/metrics.json", "w"))
try:
    socket.create_connection(("1.1.1.1", 53), timeout=3); print("NETWORK: open")
except OSError: print("NETWORK: blocked")
print("UID:", os.getuid())
import tomli; print("DEPENDENCY: ok")
`,
}), m);
ok(r.phase === "done" && r.exitCode === 0, "honest code runs to completion");
ok(compareOutput(m.outputs[0], fileOf(r, "out/metrics.json"), "", sha).match, "declared result is read and matched");
ok(r.log.includes("NETWORK: blocked"), "no network during the run");
ok(r.log.includes("UID: 65534"), "runs as an unprivileged user");
ok(r.log.includes("DEPENDENCY: ok"), "dependencies installed in setup are available");
ok(!!r.imageDigest?.includes("@sha256:"), "image digest recorded");

// 2. Hostile code: can't leak host files through symlinks, write system files or escalate.
m = manifest([{ claim: "x", file: "out/metrics.json", json: "a", reported: 1 }]);
r = await runInSandbox(archive({
  "main.py": `
import os
os.makedirs("out", exist_ok=True)
os.symlink("/etc/passwd", "out/metrics.json")
for target in ["/etc/fjournal-owned", "/usr/bin/fjournal-owned"]:
    try: open(target, "w").write("x"); print("WRITE:", target)
    except OSError: print("WRITE: denied")
try: os.setuid(0); print("SETUID: escalated")
except OSError: print("SETUID: denied")
`,
}), m);
const got = r.files.get("out/metrics.json");
ok(!Buffer.isBuffer(got) && /link/.test((got as { problem: string } | undefined)?.problem ?? ""), "symlinked outputs are refused");
ok(!r.log.includes("WRITE: /") && !r.log.includes("SETUID: escalated"), "no system writes, no privilege escalation");

// 3. Runaway code is stopped.
r = await runInSandbox(archive({ "main.py": "import time; time.sleep(600)" }), manifest([{ claim: "x", file: "o", json: "a", reported: 1 }], { timeout_minutes: 1 }));
ok(r.timedOut, "runaway code is killed at its time limit");

// 4. Nothing is left behind.
const containers = spawnSync("docker", ["ps", "-a", "--filter", "name=fj-", "--format", "{{.Names}}"]).stdout.toString().trim();
const images = spawnSync("docker", ["images", "fjournal-repro", "--format", "{{.Tag}}"]).stdout.toString().trim();
ok(!containers && !images, "containers and snapshot images are removed");

console.log(bad ? `\n${bad} FAILED — do not run the worker on this host until fixed.` : "\nALL PASSED — this host isolates code as designed.");
process.exitCode = bad ? 1 : 0;
