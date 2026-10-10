import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isModerator, openAppeals, openReports } from "@/lib/moderation";
import { MODERATION_REASONS } from "@/lib/constants";
import { ModerateReportForm } from "@/components/forms";
import { timeAgo } from "@/components/ui";

export const metadata = { title: "Moderator queue" };

export default async function QueuePage() {
  const me = await currentUser();
  if (!me) redirect("/login?next=/moderation/queue");
  if (!isModerator(me)) redirect("/moderation");
  const reports = openReports();
  const appeals = openAppeals();

  return (
    <div className="space-y-10">
      <header className="max-w-3xl space-y-2">
        <Link href="/moderation" className="text-sm text-muted hover:text-ink">← Public log</Link>
        <h1 className="font-serif text-3xl font-bold">Moderator queue</h1>
        <p className="text-muted">
          Before acting, ask: <strong>is this fraud, plagiarism or abuse, with evidence?</strong> If it&apos;s a scientific
          disagreement, however strong, dismiss it and point the reporter to reviews and replications. Everything you do
          here is published under your name.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">Open reports ({reports.length})</h2>
        {reports.length === 0 && <p className="text-sm text-muted">Nothing to review.</p>}
        {reports.map((r) => (
          <div key={r.id} className="card space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">{MODERATION_REASONS[r.reason].label}</span>
              <span className="text-muted">{r.target_type} on</span>
              <Link href={`/c/${r.contribution_id}${r.target_type === "review" ? `#${r.target_id}` : ""}`} className="text-accent underline">
                {r.title}
              </Link>
              <span className="ml-auto text-xs text-muted">reported by @{r.reporter_handle} · {timeAgo(r.created_at)}</span>
            </div>
            {r.excerpt && <blockquote className="border-l-4 border-line pl-3 text-sm text-muted">{r.excerpt}</blockquote>}
            <p className="whitespace-pre-line text-sm"><strong>Report:</strong> {r.details}</p>
            <ModerateReportForm reportId={r.id} defaultReason={r.reason} targetType={r.target_type} />
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">Open appeals ({appeals.length})</h2>
        {appeals.length === 0 && <p className="text-sm text-muted">No open appeals.</p>}
        {appeals.map((ap) => (
          <div key={ap.id} className="card flex flex-wrap items-center gap-3 p-4 text-sm">
            <span>Appeal by @{ap.appellant_handle} against</span>
            <Link href={`/moderation/${ap.action_seq}`} className="text-accent underline">log #{ap.action_seq}</Link>
            <span className="text-xs text-muted">
              {ap.moderator_id === me.id ? "You took this action, so another moderator must decide." : "Open to decide"}
            </span>
            <span className="ml-auto text-xs text-muted">{timeAgo(ap.created_at)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
