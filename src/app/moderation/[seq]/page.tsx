import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { appealsFor, getAction, isModerator, resolveTarget } from "@/lib/moderation";
import { MODERATION_REASONS } from "@/lib/constants";
import { AppealForm, ResolveAppealForm } from "@/components/forms";
import { fmtDate } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/moderation/[seq]">) {
  return { title: `Moderation log #${(await params).seq}` };
}

export default async function ActionPage({ params }: PageProps<"/moderation/[seq]">) {
  const seq = Number((await params).seq);
  const a = Number.isInteger(seq) ? getAction(seq) : undefined;
  if (!a) notFound();
  const me = await currentUser();
  const appeals = appealsFor(seq);
  const target = resolveTarget(a.target_type, a.target_id);
  const isAffected = !!me && target?.owner_id === me.id;
  const openAppeal = appeals.find((ap) => ap.status === "open");
  const canResolve = isModerator(me) && me!.id !== a.moderator_id && !isAffected;
  const targetHref =
    a.target_type === "contribution" ? `/c/${a.contribution_id}` : `/c/${a.contribution_id}#${a.target_type === "review" ? a.target_id : "discussion"}`;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link href="/moderation" className="text-sm text-muted hover:text-ink">← Moderation log</Link>
        <h1 className="mt-2 font-serif text-3xl font-bold">
          Log #{a.seq}: {a.action === "restore" ? "Restored" : a.action === "retract" ? "Retraction" : "Removal"}
        </h1>
      </div>

      <dl className="card grid gap-3 p-5 text-sm sm:grid-cols-[160px_1fr]">
        <dt className="text-muted">Concerning</dt>
        <dd>
          The {a.target_type} on <Link href={targetHref} className="text-accent underline">{a.title}</Link>
          <span className="ml-2 font-mono text-xs text-muted">fj:{a.contribution_id}</span>
        </dd>
        <dt className="text-muted">Reason</dt>
        <dd>{MODERATION_REASONS[a.reason].label}</dd>
        <dt className="text-muted">Decided by</dt>
        <dd>
          <Link href={`/u/${a.moderator_handle}`} className="underline">@{a.moderator_handle}</Link> on {fmtDate(a.created_at)}
          {a.report_id && <span className="text-muted"> · prompted by a community report</span>}
        </dd>
        {a.reverses_seq && (
          <>
            <dt className="text-muted">Reverses</dt>
            <dd><Link href={`/moderation/${a.reverses_seq}`} className="underline">Log #{a.reverses_seq}</Link></dd>
          </>
        )}
        {a.reversed_by && (
          <>
            <dt className="text-muted">Status</dt>
            <dd className="text-emerald-700 dark:text-emerald-400">
              Overturned on appeal — see <Link href={`/moderation/${a.reversed_by}`} className="underline">log #{a.reversed_by}</Link>
            </dd>
          </>
        )}
        <dt className="text-muted">Public explanation</dt>
        <dd className="whitespace-pre-line">{a.explanation}</dd>
        {a.evidence_url && (
          <>
            <dt className="text-muted">Evidence</dt>
            <dd><a href={a.evidence_url} className="break-all text-accent underline" target="_blank" rel="noreferrer nofollow">{a.evidence_url}</a></dd>
          </>
        )}
      </dl>

      {a.action !== "restore" && (
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">Appeals</h2>
          {appeals.length === 0 && <p className="text-sm text-muted">No appeals filed.</p>}
          {appeals.map((ap) => (
            <div key={ap.id} className="card space-y-3 p-5 text-sm">
              <div className="flex justify-between text-xs text-muted">
                <span>Appeal by @{ap.appellant_handle} · {fmtDate(ap.created_at)}</span>
                <span className="font-semibold uppercase">{ap.status}</span>
              </div>
              <p className="whitespace-pre-line">{ap.statement}</p>
              {ap.resolution && (
                <div className="rounded-md bg-paper p-3">
                  <p className="text-xs text-muted">Decided by @{ap.resolver_handle} · {ap.resolved_at && fmtDate(ap.resolved_at)}</p>
                  <p className="mt-1 whitespace-pre-line">{ap.resolution}</p>
                </div>
              )}
              {ap.status === "open" && canResolve && <ResolveAppealForm actionSeq={a.seq} appealId={ap.id} />}
              {ap.status === "open" && isModerator(me) && !canResolve && (
                <p className="text-xs text-muted">You can&apos;t decide this appeal: it must go to a moderator with no involvement.</p>
              )}
            </div>
          ))}
          {isAffected && !openAppeal && !a.reversed_by && (
            <div className="card p-5">
              <h3 className="mb-2 font-semibold">Appeal this decision</h3>
              <AppealForm actionSeq={a.seq} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
