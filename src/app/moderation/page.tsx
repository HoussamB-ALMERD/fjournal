import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { isModerator, listActions, moderationStats } from "@/lib/moderation";
import { MODERATION_REASONS, type ModerationReason } from "@/lib/constants";
import { fmtDate } from "@/components/ui";

export const metadata = { title: "Moderation log" };

const ACTION_STYLE = {
  retract: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  hide: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  restore: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
} as const;

export default async function ModerationLogPage() {
  const me = await currentUser();
  const actions = await listActions();
  const stats = await moderationStats();

  return (
    <div className="space-y-10">
      <header className="max-w-3xl space-y-3">
        <h1 className="font-serif text-3xl font-bold">Public moderation log</h1>
        <p className="text-muted">
          Every moderation decision on Fjournal is listed here, permanently, with the moderator&apos;s name, the reason, the
          public explanation and the evidence. Entries are never edited or deleted. Authors can appeal any decision, and a{" "}
          <em>different</em> moderator decides the appeal in public.
        </p>
        {(await isModerator(me)) && (
          <Link href="/moderation/queue" className="btn">
            Moderator queue ({stats.open_reports} reports, {stats.open_appeals} appeals)
          </Link>
        )}
      </header>

      <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card p-5">
          <h2 className="mb-3 font-serif text-lg font-semibold">The only reasons content is ever moderated</h2>
          <ul className="space-y-2 text-sm">
            {(Object.keys(MODERATION_REASONS) as ModerationReason[]).map((k) => (
              <li key={k} className="flex gap-3">
                <span className={`h-fit rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${ACTION_STYLE[MODERATION_REASONS[k].action]}`}>
                  {MODERATION_REASONS[k].action}
                </span>
                <span>
                  <strong>{MODERATION_REASONS[k].label}.</strong> {MODERATION_REASONS[k].hint}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-md bg-accent-soft p-3 text-sm">
            <strong>Never a reason:</strong> disagreeing with the conclusions, challenging a consensus, being
            &ldquo;low quality&rdquo;, or offending someone&apos;s preferred theory. Those are answered with reviews and replications.
            Retracted work stays readable, because the record of what was claimed matters.
          </p>
        </div>
        <dl className="card grid grid-cols-2 gap-4 self-start p-5 text-center">
          {[
            ["Actions taken", stats.actions],
            ["Overturned on appeal", stats.restores],
            ["Reports dismissed", stats.dismissed],
            ["Open appeals", stats.open_appeals],
          ].map(([k, v]) => (
            <div key={k}>
              <dd className="font-serif text-3xl font-semibold">{v}</dd>
              <dt className="text-xs text-muted">{k}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">All decisions</h2>
        {actions.length === 0 ? (
          <p className="card p-6 text-sm text-muted">No moderation actions have ever been taken.</p>
        ) : (
          <div className="card divide-y divide-line">
            {actions.map((a) => (
              <Link key={a.seq} href={`/moderation/${a.seq}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-paper">
                <span className="w-10 font-mono text-xs text-muted">#{a.seq}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${ACTION_STYLE[a.action]}`}>{a.action}</span>
                <span className="text-xs text-muted">{a.target_type}</span>
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
                <span className="text-xs">{MODERATION_REASONS[a.reason].label}</span>
                {a.reversed_by && <span className="text-xs text-emerald-700 dark:text-emerald-400">overturned (#{a.reversed_by})</span>}
                <span className="text-xs text-muted">@{a.moderator_handle} · {fmtDate(a.created_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
