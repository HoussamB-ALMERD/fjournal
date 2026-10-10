import { CHECK_LABELS, type CheckRow, type CheckStatus } from "@/lib/integrity/run";
import { rerunChecks } from "@/app/actions";
import { timeAgo } from "./ui";

const STATUS: Record<CheckStatus, { icon: string; cls: string; label: string }> = {
  pass: { icon: "✓", cls: "text-emerald-700 dark:text-emerald-400", label: "Consistent" },
  info: { icon: "i", cls: "text-muted", label: "Info" },
  warn: { icon: "!", cls: "text-amber-700 dark:text-amber-400", label: "Look at this" },
  fail: { icon: "✗", cls: "text-red-700 dark:text-red-400", label: "Inconsistent" },
  error: { icon: "?", cls: "text-muted", label: "Could not run" },
};

export function StatusIcon({ status }: { status: CheckStatus }) {
  const s = STATUS[status];
  return (
    <span
      title={s.label}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[11px] font-bold ${s.cls}`}
    >
      {s.icon}
    </span>
  );
}

export function IntegrityPanel({
  checks,
  contributionId,
  versionNumber,
  canRerun,
}: {
  checks: CheckRow[];
  contributionId: string;
  versionNumber: number;
  canRerun: boolean;
}) {
  return (
    <section className="space-y-4 border-t border-line pt-6" id="integrity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold">Automated integrity checks</h2>
        {canRerun && (
          <form action={rerunChecks}>
            <input type="hidden" name="contribution_id" value={contributionId} />
            <input type="hidden" name="version_number" value={versionNumber} />
            <button className="btn-ghost text-xs">Re-run checks</button>
          </form>
        )}
      </div>
      <p className="text-sm text-muted">
        Run on every version, public for everyone. A flag is a prompt for human attention, <strong>not an accusation</strong>:
        typos, one-tailed tests and continuous measures all cause legitimate mismatches. Checks never hide or remove anything.
      </p>
      {checks.length === 0 ? (
        <p className="card p-4 text-sm text-muted">Checks are running for this version. Refresh in a moment.</p>
      ) : (
        <div className="card divide-y divide-line">
          {checks.map((c) => (
            <details key={c.kind} className="group p-4" open={c.status === "fail" || c.status === "warn"}>
              <summary className="flex cursor-pointer list-none items-start gap-3">
                <StatusIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{CHECK_LABELS[c.kind].label}</div>
                  <div className="text-sm text-muted">{c.summary}</div>
                </div>
                <span className="shrink-0 text-xs text-muted">{timeAgo(c.created_at)}</span>
              </summary>
              <div className="mt-3 space-y-2 pl-8">
                <p className="text-xs text-muted">{CHECK_LABELS[c.kind].about}</p>
                {c.details.map((f, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <StatusIcon status={f.status} />
                    <div className="min-w-0">
                      <code className="break-all rounded bg-line/50 px-1 font-mono text-xs">{f.text}</code>
                      <p className="text-xs text-muted">{f.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
