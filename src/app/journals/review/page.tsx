import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isModerator } from "@/lib/moderation";
import { drafts, journalPage, openCorrections, pendingReplies } from "@/lib/index/index";
import { PublishAssessmentForm, ResolveCorrectionForm, ReviewReplyForm, WithdrawAssessmentForm } from "@/components/IndexForms";
import { PropCell } from "@/components/IndexBits";
import { fmtDate } from "@/components/ui";

export const metadata = { title: "Index review" };

export default async function IndexReviewPage() {
  const me = await currentUser();
  if (!isModerator(me)) notFound();
  const ds = drafts();
  const replies = pendingReplies();
  const corrections = openCorrections();

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="font-serif text-3xl font-bold">Journal Integrity Index: review</h1>
        <p className="text-muted">
          Drafts need a second moderator before publication. Check the sampled articles, the data statements and the flagged tests
          on each journal&apos;s page first. Sweeps are run with <code>npm run index -- sweep</code>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">Drafts ({ds.length})</h2>
        {ds.length === 0 && <p className="text-sm text-muted">No drafts.</p>}
        {ds.map((a) => {
          const p = journalPage(a.issn, true);
          return (
            <article key={a.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <Link href={`/journals/${a.issn}`} className="font-semibold hover:text-accent">{a.title}</Link>
                <span className="text-xs text-muted">
                  {a.window_from} – {a.window_until} · swept by @{a.created_by_handle} {fmtDate(a.created_at)}
                </span>
              </div>
              {p && p.assessment.id === a.id && (
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <span>Flips: <PropCell p={p.indicators.statistics.gross} /></span>
                  <span>Data: <PropCell p={p.indicators.data.shared} /></span>
                  <span>CC: <PropCell p={p.indicators.license.cc} /></span>
                  <span>Retr./10k: <PropCell p={p.indicators.retractions.rate} scale={10_000} /></span>
                </div>
              )}
              <PublishAssessmentForm id={a.id} own={a.created_by_handle === me!.handle} />
              <WithdrawAssessmentForm id={a.id} />
            </article>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">Replies awaiting identity checks ({replies.length})</h2>
        {replies.length === 0 && <p className="text-sm text-muted">None.</p>}
        {replies.map((r) => (
          <article key={r.id} className="card space-y-2 p-4 text-sm">
            <p className="text-xs text-muted">
              <Link href={`/journals/${r.issn}#replies`} className="underline">{r.title}</Link> · @{r.handle} says they are &ldquo;{r.role}&rdquo; · {fmtDate(r.created_at)}
            </p>
            <p className="whitespace-pre-line">{r.body}</p>
            <ReviewReplyForm id={r.id} issn={r.issn} />
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl font-semibold">Open correction requests ({corrections.length})</h2>
        {corrections.length === 0 && <p className="text-sm text-muted">None.</p>}
        {corrections.map((c) => (
          <article key={c.id} className="card space-y-2 p-4 text-sm">
            <p className="text-xs text-muted">
              <Link href={`/journals/${c.issn}#corrections`} className="underline">{c.title}</Link> · {c.indicator}
              {c.doi && <> · <a href={`https://doi.org/${c.doi}`} className="font-mono underline">{c.doi}</a></>} · @{c.handle}
            </p>
            <p>{c.claim}</p>
            {c.evidence_url && <a href={c.evidence_url} className="text-xs underline" target="_blank" rel="noreferrer nofollow">Evidence</a>}
            <ResolveCorrectionForm id={c.id} issn={c.issn} />
          </article>
        ))}
      </section>
    </div>
  );
}
