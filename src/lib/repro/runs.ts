import "server-only";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { all, get, run, tx, now } from "../db";
import { canonicalJson } from "../hash";
import type { Artifact } from "../ledger";
import { FetchError, safeFetchBuffer, safeOpen } from "../integrity/safe-fetch";
import type { Finding } from "../integrity/stats";
import { MANIFEST_FILE, compareOutput, parseManifest, type Manifest, type OutputResult } from "./manifest";
import { runInSandbox } from "./sandbox";

/**
 * The reproducibility bot. The web app only enqueues runs; `npm run worker` executes them, one at a
 * time, in the Docker sandbox. A run downloads the exact pinned commit, follows fjournal.json, and
 * compares every declared result with what the code actually produced.
 */

export type RunStatus = "queued" | "running" | "reproduced" | "mismatch" | "failed" | "invalid" | "error";
export const FINISHED: RunStatus[] = ["reproduced", "mismatch", "failed", "invalid", "error"];

export class ReproError extends Error {}

/** Set on the web app and the worker when a worker is deployed. Without it nothing is queued. */
export const reproEnabled = () => process.env.FJOURNAL_REPRO_ENABLED === "1";

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const DAILY_REQUESTS = 5;
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// ───────────────────────────── Where the code lives ─────────────────────────────

export type CodeTarget = { owner: string; repo: string; pin: string; url: string };

/** The first code or notebook artifact pinned to a GitHub commit. */
export function codeTarget(artifacts: Artifact[]): CodeTarget | null {
  for (const a of artifacts) {
    if (a.kind !== "code" && a.kind !== "notebook") continue;
    const gh = a.url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/);
    if (gh && /^[0-9a-f]{7,40}$/i.test(a.pin.trim())) return { owner: gh[1], repo: gh[2], pin: a.pin.trim().toLowerCase(), url: a.url };
  }
  return null;
}

export type RunSource = {
  repo: string;
  commit: string;
  manifestText: string | null;
  download: () => Promise<{ path: string; sha256: string; cleanup: () => void }>;
};

async function resolveCommit(t: CodeTarget): Promise<string> {
  if (/^[0-9a-f]{40}$/.test(t.pin)) return t.pin;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "Fjournal-repro-bot" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${t.owner}/${t.repo}/commits/${t.pin}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404 || res.status === 422) throw new ReproError(`Commit ${t.pin} was not found in ${t.owner}/${t.repo}.`);
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
  return ((await res.json()) as { sha: string }).sha;
}

export async function fetchManifestText(owner: string, repo: string, commit: string): Promise<string | null> {
  try {
    const { buffer } = await safeFetchBuffer(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${MANIFEST_FILE}`, 256 * 1024, 20_000);
    return buffer.toString("utf8");
  } catch (e) {
    if (e instanceof FetchError && e.status === 404) return null;
    throw e;
  }
}

/** The pinned commit on GitHub. Tests substitute a local source. */
export async function githubSource(t: CodeTarget): Promise<RunSource> {
  const commit = await resolveCommit(t);
  return {
    repo: `${t.owner}/${t.repo}`,
    commit,
    manifestText: await fetchManifestText(t.owner, t.repo, commit),
    download: async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fjournal-repro-"));
      const file = path.join(dir, "src.tar.gz");
      const o = await safeOpen(`https://codeload.github.com/${t.owner}/${t.repo}/tar.gz/${commit}`, 120_000);
      const h = createHash("sha256");
      const out = fs.createWriteStream(file);
      let size = 0;
      try {
        for await (const chunk of o.stream) {
          size += chunk.length;
          if (size > MAX_ARCHIVE_BYTES) throw new ReproError(`The repository archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB.`);
          h.update(chunk);
          if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
        }
      } finally {
        o.stream.destroy();
        await new Promise<void>((r) => out.end(() => r()));
      }
      return { path: file, sha256: h.digest("hex"), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    },
  };
}

// ───────────────────────────── Queue ─────────────────────────────

type VersionInfo = { seq: number; contribution_id: string; artifacts: string; status: string; source_kind: string | null };
const versionInfo = (seq: number) =>
  get<VersionInfo>(
    `SELECT v.seq, v.contribution_id, v.artifacts, c.status, c.source_kind
     FROM versions v JOIN contributions c ON c.id = v.contribution_id WHERE v.seq = ?`,
    seq,
  );

/** Queues a run for a version if it has pinned code. Returns the run id, or null if there's nothing to run. */
export function enqueueRun(versionSeq: number, requestedBy: string | null): string | null {
  const v = versionInfo(versionSeq);
  if (!v || v.status === "hidden" || v.source_kind || !codeTarget(JSON.parse(v.artifacts))) return null;
  if (get("SELECT 1 FROM repro_runs WHERE version_seq = ? AND status IN ('queued','running')", versionSeq)) return null;
  const id = `run_${randomBytes(6).toString("hex")}`;
  run(
    "INSERT INTO repro_runs (id, version_seq, contribution_id, status, requested_by, created_at) VALUES (?,?,?,?,?,?)",
    id, versionSeq, v.contribution_id, "queued", requestedBy, now(),
  );
  return id;
}

/** A person asking for a (re-)run. Runs cost real compute, so they're rate limited. */
export function requestRun(versionSeq: number, userId: string): string {
  if (!reproEnabled()) throw new ReproError("The reproducibility bot isn't enabled on this Fjournal instance yet.");
  const v = versionInfo(versionSeq);
  if (!v || v.status === "hidden") throw new ReproError("Version not found.");
  if (v.source_kind) throw new ReproError("Imported works can't be run yet: their code isn't pinned on Fjournal.");
  if (!codeTarget(JSON.parse(v.artifacts))) throw new ReproError("This version has no code pinned to a GitHub commit.");
  if (get("SELECT 1 FROM repro_runs WHERE version_seq = ? AND status IN ('queued','running')", versionSeq))
    throw new ReproError("A run for this version is already queued.");
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  if (get("SELECT 1 FROM repro_runs WHERE version_seq = ? AND finished_at > ? AND status <> 'error'", versionSeq, hourAgo))
    throw new ReproError("This version was run within the last hour. Results are deterministic enough that a re-run can wait.");
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  if (get<{ n: number }>("SELECT COUNT(*) AS n FROM repro_runs WHERE requested_by = ? AND created_at > ?", userId, dayAgo)!.n >= DAILY_REQUESTS)
    throw new ReproError(`You can request up to ${DAILY_REQUESTS} runs a day.`);
  return enqueueRun(versionSeq, userId)!;
}

export function claimNextRun(worker: string): { id: string } | null {
  return tx(() => {
    const next = get<{ id: string }>("SELECT id FROM repro_runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1");
    if (!next) return null;
    run("UPDATE repro_runs SET status = 'running', worker = ?, started_at = ? WHERE id = ?", worker, now(), next.id);
    return next;
  });
}

/** Runs left 'running' by a worker that died are reported, never silently retried. */
export function recoverStaleRuns(worker: string) {
  run(
    "UPDATE repro_runs SET status = 'error', summary = 'The worker stopped during this run. Request a new run.', finished_at = ? WHERE status = 'running' AND worker = ?",
    now(), worker,
  );
}

// ───────────────────────────── Execution ─────────────────────────────

type Finish = Partial<{
  summary: string; repo: string; commit_sha: string; archive_sha256: string; image: string; image_digest: string | null;
  manifest: string; results: OutputResult[]; log: string; exit_code: number | null; setup_seconds: number; run_seconds: number;
}>;

function finish(id: string, status: RunStatus, f: Finish) {
  const row = get<{ version_seq: number }>("SELECT version_seq FROM repro_runs WHERE id = ?", id)!;
  const versionHash = get<{ h: string }>("SELECT content_hash AS h FROM versions WHERE seq = ?", row.version_seq)!.h;
  const resultHash = createHash("sha256")
    .update(canonicalJson({
      version_content_hash: versionHash, status, repo: f.repo, commit: f.commit_sha, archive_sha256: f.archive_sha256,
      image: f.image, image_digest: f.image_digest, manifest: f.manifest, results: f.results,
    }))
    .digest("hex");
  run(
    `UPDATE repro_runs SET status = ?, summary = ?, repo = ?, commit_sha = ?, archive_sha256 = ?, image = ?, image_digest = ?,
       manifest = ?, results = ?, log = ?, exit_code = ?, setup_seconds = ?, run_seconds = ?, result_hash = ?, finished_at = ?
     WHERE id = ?`,
    status, f.summary ?? "", f.repo ?? null, f.commit_sha ?? null, f.archive_sha256 ?? null, f.image ?? null, f.image_digest ?? null,
    f.manifest ?? null, f.results ? JSON.stringify(f.results) : null, f.log ?? null, f.exit_code ?? null,
    f.setup_seconds ?? null, f.run_seconds ?? null, resultHash, now(), id,
  );
}

export async function executeRun(id: string, getSource: (t: CodeTarget) => Promise<RunSource> = githubSource) {
  const r = get<{ version_seq: number }>("SELECT version_seq FROM repro_runs WHERE id = ?", id);
  if (!r) return;
  const v = get<{ artifacts: string; abstract: string; body: string }>("SELECT artifacts, abstract, body FROM versions WHERE seq = ?", r.version_seq)!;
  const target = codeTarget(JSON.parse(v.artifacts));
  if (!target) return finish(id, "invalid", { summary: "No code pinned to a GitHub commit." });

  const f: Finish = {};
  try {
    const src = await getSource(target);
    Object.assign(f, { repo: src.repo, commit_sha: src.commit });
    if (src.manifestText === null)
      return finish(id, "invalid", { ...f, summary: `No ${MANIFEST_FILE} at the pinned commit, so the bot doesn't know how to run the code or what it should produce.` });
    f.manifest = src.manifestText;
    const parsed = parseManifest(src.manifestText);
    if (!parsed.ok) return finish(id, "invalid", { ...f, summary: `${MANIFEST_FILE} has problems: ${parsed.errors.join(" ")}` });
    const m: Manifest = parsed.value;
    f.image = m.image;

    const dl = await src.download();
    f.archive_sha256 = dl.sha256;
    try {
      const res = await runInSandbox(dl.path, m);
      Object.assign(f, { image_digest: res.imageDigest, log: res.log, exit_code: res.exitCode, setup_seconds: res.setupSeconds, run_seconds: res.runSeconds });
      const paper = `${v.abstract}\n${v.body}`;
      f.results = m.outputs.map((o) => {
        const got = res.files.get(o.file);
        const content = Buffer.isBuffer(got) ? got : null;
        const result = compareOutput(o, content, paper, sha256);
        if (!content && got && "problem" in got) result.problem = `${o.file} ${got.problem}.`;
        return result;
      });
      const n = f.results.length;
      const matched = f.results.filter((x) => x.match).length;
      if (res.phase === "setup")
        return finish(id, "failed", { ...f, summary: res.timedOut ? "Setup timed out." : `Setup failed (exit code ${res.exitCode}).` });
      if (res.timedOut) return finish(id, "failed", { ...f, summary: `The run exceeded its ${m.timeout_minutes ?? 30}-minute limit.` });
      if (res.exitCode !== 0) return finish(id, "failed", { ...f, summary: `The run exited with code ${res.exitCode}. ${matched} of ${n} results were checked anyway.` });
      if (matched === n) return finish(id, "reproduced", { ...f, summary: `All ${n} declared result${n === 1 ? "" : "s"} reproduced from the pinned code.` });
      return finish(id, "mismatch", { ...f, summary: `${n - matched} of ${n} declared results differ from the reported values.` });
    } finally {
      dl.cleanup();
    }
  } catch (e) {
    const known = e instanceof ReproError;
    return finish(id, known ? "invalid" : "error", { ...f, summary: known ? e.message : `The bot couldn't complete the run: ${(e as Error).message}` });
  }
}

// ───────────────────────────── Reading ─────────────────────────────

export type RunRow = {
  id: string; version_seq: number; status: RunStatus; summary: string; repo: string | null; commit_sha: string | null;
  archive_sha256: string | null; image: string | null; image_digest: string | null; manifest: string | null;
  results: OutputResult[] | null; log: string | null; exit_code: number | null; setup_seconds: number | null;
  run_seconds: number | null; result_hash: string | null; requested_by_handle: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
};

export function runsForVersion(seq: number): RunRow[] {
  return all<Omit<RunRow, "results"> & { results: string | null }>(
    `SELECT r.*, u.handle AS requested_by_handle FROM repro_runs r LEFT JOIN users u ON u.id = r.requested_by
     WHERE r.version_seq = ? ORDER BY r.created_at DESC`,
    seq,
  ).map((r) => ({ ...r, results: r.results ? JSON.parse(r.results) : null }));
}

/** True when the latest version's most recent finished run reproduced every declared result. */
export function computationallyReproduced(contributionId: string): boolean {
  const last = get<{ status: string }>(
    `SELECT r.status FROM repro_runs r
     JOIN contributions c ON c.id = r.contribution_id
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version AND v.seq = r.version_seq
     WHERE r.contribution_id = ? AND r.status IN ('reproduced','mismatch','failed','invalid')
     ORDER BY r.finished_at DESC LIMIT 1`,
    contributionId,
  );
  return last?.status === "reproduced";
}

/** Integrity-check view of the manifest, so authors see problems before anything runs. */
export async function manifestCheck(artifacts: Artifact[]): Promise<Finding[]> {
  const t = codeTarget(artifacts);
  if (!t) return [];
  let commit: string;
  try {
    commit = await resolveCommit(t);
  } catch (e) {
    return [{ status: "warn", text: t.url, message: (e as Error).message }];
  }
  const text = await fetchManifestText(t.owner, t.repo, commit);
  if (text === null)
    return [{ status: "info", text: `${t.owner}/${t.repo}@${commit.slice(0, 10)}`, message: `No ${MANIFEST_FILE}. Add one to let the reproducibility bot re-run this code. See /tools/reproduce.` }];
  const p = parseManifest(text);
  return p.ok
    ? [{ status: "pass", text: `${t.owner}/${t.repo}@${commit.slice(0, 10)}/${MANIFEST_FILE}`, message: `Valid: ${p.value.outputs.length} declared result(s), image ${p.value.image}.` }]
    : p.errors.map((err) => ({ status: "fail" as const, text: MANIFEST_FILE, message: err }));
}
