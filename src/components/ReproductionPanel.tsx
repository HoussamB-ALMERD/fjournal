import Link from "next/link";
import type { RunRow, RunStatus } from "@/lib/repro/runs";
import { RequestReproductionForm } from "./forms";
import { fmtDate, timeAgo } from "./ui";

const STATUS: Record<RunStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "border-line text-muted" },
  running: { label: "Running", cls: "border-blue-600/40 text-blue-700 dark:text-blue-300" },
  reproduced: { label: "Reproduced", cls: "border-teal-600/50 bg-teal-50 text-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  mismatch: { label: "Results differ", cls: "border-red-600/50 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300" },
  failed: { label: "Run failed", cls: "border-amber-600/50 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  invalid: { label: "Can't run yet", cls: "border-line text-muted" },
  error: { label: "Bot error", cls: "border-line text-muted" },
};

export function RunStatusChip({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function ReproductionPanel({
  runs,
  hasCode,
  enabled,
  canRequest,
  contributionId,
  versionNumber,
}: {
  runs: RunRow[];
  hasCode: boolean;
  enabled: boolean;
  canRequest: boolean;
  contributionId: string;
  versionNumber: number;
}) {
  const [latest, ...older] = runs;
  const active = latest && (latest.status === "queued" || latest.status === "running");
  return (
    <section className="space-y-4 border-t border-line pt-6" id="reproduction">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold">Computational reproducibility</h2>
        <Link href="/tools/reproduce" className="text-xs text-accent underline">How it works</Link>
      </div>
      <p className="text-sm text-muted">
        The reproducibility bot downloads the exact pinned commit, runs it in an isolated sandbox with no network access, and
        checks every result the authors declared in <code>fjournal.json</code> against what the code actually produces.
      </p>

      {!hasCode ? (
        <p className="card p-4 text-sm text-muted">
          No code pinned to a GitHub commit in this version. Attach the code with its commit SHA, and add a{" "}
          <Link href="/tools/reproduce" className="text-accent underline">fjournal.json</Link>, to have it re-run.
        </p>
      ) : !latest ? (
        <p className="card p-4 text-sm text-muted">
          {enabled ? "Not run yet." : "The reproducibility bot isn't enabled on this Fjournal instance yet."}
        </p>
      ) : (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <RunStatusChip status={latest.status} />
            <span className="text-sm">{active ? (latest.status === "queued" ? "Waiting for the bot…" : "Running now…") : latest.summary}</span>
            <span className="ml-auto text-xs text-muted">
              {latest.finished_at ? timeAgo(latest.finished_at) : timeAgo(latest.created_at)}
              {latest.requested_by_handle ? ` · requested by @${latest.requested_by_handle}` : " · automatic"}
            </span>
          </div>

          {latest.results && latest.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3">Claim</th>
                    <th className="py-1 pr-3">Reported</th>
                    <th className="py-1 pr-3">Reproduced</th>
                    <th className="py-1 pr-3">Tolerance</th>
                    <th className="py-1">In paper text</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {latest.results.map((r, i) => (
                    <tr key={i} className="align-top">
                      <td className="py-2 pr-3">
                        <span className={r.match ? "text-teal-700 dark:text-teal-400" : "text-red-700 dark:text-red-400"}>{r.match ? "✓" : "✗"}</span>{" "}
                        {r.claim}
                        <div className="font-mono text-[11px] text-muted">{r.file}</div>
                        {r.problem && <div className="text-xs text-red-700 dark:text-red-400">{r.problem}</div>}
                      </td>
                      <td className="py-2 pr-3 font-mono">{r.reported ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono">{r.observed ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.tolerance !== null ? `±${Number(r.tolerance.toPrecision(3))}` : "exact"}</td>
                      <td className="py-2 text-xs">
                        {r.in_paper === null ? "—" : r.in_paper ? "found" : <span title="Check the declared value matches the paper">not found</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {latest.repo && (
            <dl className="grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-[130px_1fr]">
              <dt>Code</dt>
              <dd className="break-all font-mono">
                <a href={`https://github.com/${latest.repo}/tree/${latest.commit_sha}`} className="underline" target="_blank" rel="noreferrer">
                  {latest.repo}@{latest.commit_sha?.slice(0, 12)}
                </a>
              </dd>
              {latest.archive_sha256 && (<><dt>Source archive</dt><dd className="break-all font-mono">sha256:{latest.archive_sha256}</dd></>)}
              {latest.image && (<><dt>Environment</dt><dd className="break-all font-mono">{latest.image_digest ?? latest.image}</dd></>)}
              {latest.run_seconds !== null && (
                <><dt>Time</dt><dd>setup {Math.round(latest.setup_seconds ?? 0)} s · run {Math.round(latest.run_seconds)} s{latest.exit_code !== null && ` · exit code ${latest.exit_code}`}</dd></>
              )}
              {latest.result_hash && (<><dt>Result hash</dt><dd className="break-all font-mono">sha256:{latest.result_hash}</dd></>)}
              {latest.finished_at && (<><dt>Finished</dt><dd>{fmtDate(latest.finished_at)}</dd></>)}
            </dl>
          )}

          {latest.log && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted">Output log</summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-paper p-3 font-mono text-[11px] leading-5">{latest.log}</pre>
            </details>
          )}
        </div>
      )}

      {hasCode && enabled && canRequest && !active && <RequestReproductionForm contributionId={contributionId} versionNumber={versionNumber} />}

      {older.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">Earlier runs of this version ({older.length})</summary>
          <ul className="mt-2 space-y-1">
            {older.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <RunStatusChip status={r.status} /> {r.summary} · {timeAgo(r.finished_at ?? r.created_at)}
                {r.result_hash && <span className="hash">sha256:{r.result_hash.slice(0, 16)}…</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
