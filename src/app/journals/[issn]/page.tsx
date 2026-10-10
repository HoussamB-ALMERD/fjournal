import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isModerator } from "@/lib/moderation";
import { canViewIndex, indexPublic, journalPage } from "@/lib/index/index";
import { DATA_CLASSES, INDICATORS, MIN_SAMPLE, SHARED, normalizeIssn, type DataClass, type IndicatorKey } from "@/lib/index/method";
import { Prop, PreviewBanner } from "@/components/IndexBits";
import { CorrectionForm, ReplyForm } from "@/components/IndexForms";
import { fmtDate } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/journals/[issn]">): Promise<Metadata> {
  const { issn } = await params;
  return { title: `Journal Integrity Index · ${issn}`, robots: indexPublic() ? undefined : { index: false } };
}

function Card({ k, children, baseline }: { k: IndicatorKey; children: React.ReactNode; baseline: React.ReactNode }) {
  const i = INDICATORS[k];
  return (
    <section className="card space-y-2 p-5" id={k}>
      <h2 className="font-serif text-lg font-semibold">{i.label}</h2>
      <p className="text-sm text-muted">{i.question}</p>
      <div className="space-y-1 text-sm">{children}</div>
      <p className="text-xs">Field baseline: {baseline}</p>
      <p className="border-t border-line pt-2 text-xs text-muted">{i.caution}</p>
    </section>
  );
}

export default async function JournalPage({ params }: PageProps<"/journals/[issn]">) {
  const { issn: raw } = await params;
  const issn = normalizeIssn(raw);
  const me = await currentUser();
  if (!issn || !(await canViewIndex(me))) notFound();
  const preview = await isModerator(me);
  const d = await journalPage(issn, preview);
  if (!d) notFound();
  const { journal: j, assessment: a, indicators: ind, baselines: b } = d;
  const draft = a.status === "draft";
  const r = ind.retractions;

  return (
    <div className="space-y-8">
      <PreviewBanner notPublic={!indexPublic()} draft={draft} />

      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          <Link href="/journals" className="hover:underline">Journal Integrity Index</Link> · method{" "}
          <Link href="/journals/method" className="underline">{a.method_version}</Link>
        </p>
        <h1 className="font-serif text-3xl font-bold">{j.title}</h1>
        <p className="text-muted">
          {j.publisher} · ISSN {j.issns.join(", ")} · field: {j.field}
        </p>
        <p className="text-sm">
          Articles published <strong>{a.window_from}</strong> to <strong>{a.window_until}</strong>:{" "}
          {a.total_articles.toLocaleString("en")} in Crossref; {ind.sample} sampled at random, {ind.with_fulltext} with open full text read.
        </p>
        <p className="text-xs text-muted">
          Swept by @{a.created_by_handle} on {fmtDate(a.created_at)}
          {a.published_at ? <> · checked and published by @{a.published_by_handle} on {fmtDate(a.published_at)}</> : " · not yet published"}
          {a.published_hash && (
            <>
              {" "}· <span className="font-mono">sha256 {a.published_hash.slice(0, 16)}…</span>{" "}
              {d.hashOk ? "✓ measurements unchanged since publication" : <strong className="text-red-700">✗ measurements changed since publication</strong>}
            </>
          )}
        </p>
        {a.notes && <p className="rounded-md bg-amber-50 p-2 text-sm dark:bg-amber-950">{a.notes}</p>}
      </header>

      <div className="card space-y-1 border-accent/40 p-4 text-sm">
        <p>
          <strong>How to read this.</strong> Four separate indicators, each with a 95% interval and a baseline for journals in the
          same field. There is no overall score and no ranking, because the indicators measure different things and none of them
          is a verdict on any article or person. Every figure is computed from the sampled articles listed at the bottom, which anyone
          can check.
        </p>
        <p className="text-xs text-muted">
          Below {MIN_SAMPLE} articles, sample-based indicators show &ldquo;insufficient data&rdquo; instead of a number. Baselines need at
          least three journals in the field ({b.journals} so far).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card k="statistics" baseline={<Prop p={b.statistics} />}>
          <p>Articles with a significance-flipping inconsistency: <Prop p={ind.statistics.gross} /></p>
          <p>Articles with any inconsistency: <Prop p={ind.statistics.any} /></p>
          <p className="text-xs text-muted">{ind.statistics.tests} reported tests recomputed.</p>
        </Card>
        <Card k="data" baseline={<Prop p={b.data} />}>
          <p>Data in a repository or with the article: <Prop p={ind.data.shared} /></p>
          <ul className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
            {(Object.keys(DATA_CLASSES) as DataClass[]).map((c) => (
              <li key={c} className="contents">
                <span className={`text-right font-mono ${SHARED.includes(c) ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{ind.data.by_class[c]}</span>
                <span className="text-muted">{DATA_CLASSES[c]}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card k="license" baseline={<Prop p={b.license} />}>
          <p>With a Creative Commons licence: <Prop p={ind.license.cc} /></p>
        </Card>
        <Card k="retractions" baseline={<Prop p={b.retractions} scale={10_000} unit=" per 10,000" />}>
          <p>Retracted since publication: <Prop p={r.rate} scale={10_000} unit=" per 10,000" /></p>
          <p>
            Median time to retraction:{" "}
            <strong>{r.median_days === null ? "–" : `${Math.round(r.median_days)} days`}</strong>
            {r.median_days !== null && <span className="text-muted"> ({a.retraction_days.length} retractions with dates)</span>}
          </p>
          <p>With an expression of concern: <Prop p={r.concerns} scale={10_000} unit=" per 10,000" /></p>
        </Card>
      </div>

      <section className="card space-y-2 p-5 text-sm">
        <h2 className="font-serif text-lg font-semibold">Open review on Fjournal</h2>
        {d.onFjournal.works === 0 ? (
          <p className="text-muted">
            None of this journal&apos;s articles has been opened for review on Fjournal yet.{" "}
            <Link href="/import" className="text-accent underline">Open one</Link>.
          </p>
        ) : (
          <p>
            {d.onFjournal.works} of its articles opened for review here, with {d.onFjournal.reviews} public reviews and independent
            replications: {d.onFjournal.reproduced} reproduced, {d.onFjournal.partial} partially, {d.onFjournal.failed} failed.
            Counts this small describe those articles, not the journal.
          </p>
        )}
      </section>

      <section className="space-y-3" id="replies">
        <h2 className="font-serif text-xl font-semibold">The journal&apos;s reply</h2>
        {d.replies.filter((x) => x.status === "published").length === 0 && (
          <p className="text-sm text-muted">The journal hasn&apos;t replied. Replies are published verbatim once a moderator confirms who sent them.</p>
        )}
        {d.replies.map((x) => (
          <article key={x.id} className={`card space-y-2 p-4 ${x.status !== "published" ? "opacity-60" : ""}`}>
            <p className="text-xs text-muted">
              {x.display_name}, {x.role}
              {x.status === "published" && x.reviewed_by_handle && <> · identity confirmed by @{x.reviewed_by_handle}: {x.review_note}</>}
              {x.status !== "published" && <> · <strong>{x.status}</strong> (visible to moderators only)</>}
            </p>
            <p className="whitespace-pre-line text-sm leading-6">{x.body}</p>
          </article>
        ))}
        {me && <ReplyForm issn={issn} />}
      </section>

      <section className="space-y-3" id="corrections">
        <h2 className="font-serif text-xl font-semibold">Corrections ({d.corrections.length})</h2>
        {d.corrections.length === 0 && <p className="text-sm text-muted">No correction requests yet.</p>}
        {d.corrections.map((c) => (
          <article key={c.id} className="card space-y-1 p-4 text-sm">
            <p className="text-xs text-muted">
              {INDICATORS[c.indicator as IndicatorKey]?.label ?? "Other"}
              {c.doi && <> · <span className="font-mono">{c.doi}</span></>} · requested by @{c.requester_handle} ·{" "}
              <strong className={c.status === "accepted" ? "text-emerald-700" : c.status === "rejected" ? "" : "text-amber-700"}>{c.status}</strong>
            </p>
            <p>{c.claim}</p>
            {c.evidence_url && <a href={c.evidence_url} className="text-xs underline" target="_blank" rel="noreferrer nofollow">Evidence</a>}
            {c.resolution && <p className="rounded-md bg-paper p-2 text-xs">Resolution by @{c.resolver_handle}: {c.resolution}</p>}
          </article>
        ))}
        {me && <CorrectionForm assessmentId={a.id} dois={d.articles.map((x) => x.doi)} />}
      </section>

      <section className="space-y-3" id="articles">
        <h2 className="font-serif text-xl font-semibold">The sampled articles ({d.articles.length})</h2>
        <p className="text-sm text-muted">
          Every measurement behind the figures above. Articles are linked to their DOI; statements and tests are quoted as they appear.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-3 py-2">Article</th>
                <th className="px-3 py-2">Licence</th>
                <th className="px-3 py-2">Statistics</th>
                <th className="px-3 py-2">Data availability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {d.articles.map((x) => (
                <tr key={x.doi}>
                  <td className="max-w-xs px-3 py-2">
                    <a href={`https://doi.org/${x.doi}`} className="line-clamp-2 hover:text-accent" target="_blank" rel="noreferrer">{x.title || x.doi}</a>
                    <span className="font-mono text-[11px] text-muted">{x.doi} · {x.issued ?? "n.d."}</span>
                    {x.excluded.length > 0 && <span className="block text-[11px] text-amber-700">excluded by correction from: {x.excluded.join(", ")}</span>}
                    {x.error && <span className="block text-[11px] text-red-700">{x.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{x.cc_license === null ? "–" : x.cc_license ? "CC" : "not CC"}</td>
                  <td className="px-3 py-2 text-xs">
                    {!x.fulltext ? (
                      <span className="text-muted">no open full text</span>
                    ) : x.tests === 0 ? (
                      <span className="text-muted">no APA tests</span>
                    ) : (
                      <details>
                        <summary className="cursor-pointer">
                          {x.tests} tests · {x.inconsistent} inconsistent · <span className={x.gross ? "font-semibold text-red-700" : ""}>{x.gross} flip significance</span>
                          {x.one_tailed > 0 && <> · {x.one_tailed} one-tailed?</>}
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {x.findings.map((f, i) => (
                            <li key={i}>
                              <code className="text-[11px]">{f.text}</code>
                              <span className="block text-muted">{f.message}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                  <td className="max-w-sm px-3 py-2 text-xs">
                    {x.data_class ? (
                      <>
                        <span className={SHARED.includes(x.data_class) ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold"}>
                          {x.data_class}
                        </span>
                        {x.data_excerpt && <span className="mt-0.5 block text-muted">&ldquo;{x.data_excerpt}&rdquo;</span>}
                      </>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {d.history.length > 1 && (
        <section className="space-y-2 text-sm">
          <h2 className="font-serif text-xl font-semibold">Earlier assessments</h2>
          <ul className="space-y-1 text-muted">
            {d.history.filter((h) => h.id !== a.id).map((h) => (
              <li key={h.id}>
                {h.window_from} – {h.window_until} · method {h.method_version} · {h.status}
                {h.notes && <> · {h.notes}</>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted">
        Data: <a href={`/api/journals/${issn}`} className="underline">this assessment as JSON</a>, including every article measurement.
      </p>
    </div>
  );
}
