/**
 * The reproducibility worker: executes queued runs one at a time in the Docker sandbox.
 * Run it on a dedicated machine, never on the web server:  npm run worker  (or  npm run worker -- --once)
 * Needs FJOURNAL_REPRO_ENABLED=1 (also set on the web app so publications are queued) and a Docker engine.
 */
import os from "node:os";
import { claimNextRun, executeRun, recoverStaleRuns, reproEnabled } from "../src/lib/repro/runs";
import { dockerAvailable } from "../src/lib/repro/sandbox";

const once = process.argv.includes("--once");
const worker = `${os.hostname()}:${process.pid}`;
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

void (async () => {
  if (!reproEnabled()) {
    console.error("Set FJOURNAL_REPRO_ENABLED=1 to run the reproducibility worker.");
    process.exit(1);
  }
  const version = await dockerAvailable();
  if (!version) {
    console.error("Docker engine not reachable. The worker never runs code outside a container, so it won't start.");
    process.exit(1);
  }
  console.log(`Reproducibility worker ${worker} (Docker ${version}) waiting for runs…`);
  recoverStaleRuns(worker);
  while (!stopping) {
    const next = claimNextRun(worker);
    if (!next) {
      if (once) break;
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const t0 = Date.now();
    console.log(`→ ${next.id}`);
    await executeRun(next.id);
    console.log(`  done in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  console.log("Worker stopped.");
})();
