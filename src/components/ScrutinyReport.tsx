import type { ReportData, WorkEvidence } from "@/lib/report";
import { CONTRIBUTION_TYPES, RECOMMENDATIONS, type ContributionType, type Recommendation } from "@/lib/constants";
import type { CheckStatus } from "@/lib/integrity/run";

const CHECK_TEXT: Record<CheckStatus, [string, string]> = {
  pass: ["✓ passed", "text-emerald-700 dark:text-emerald-400 print:text-emerald-800"],
  info: ["✓ notes only", "text-emerald-700 dark:text-emerald-400 print:text-emerald-800"],
  warn: ["⚠ warnings", "text-amber-700 dark:text-amber-400 print:text-amber-800"],
  fail: ["✗ problems found", "text-red-700 dark:text-red-400 print:text-red-800"],
  error: ["– couldn't run", "text-muted"],
};

/** Short forms so a work's review line fits on one printed line. */
const REC_SHORT: Record<Recommendation, string> = { sound: "sound", minor_issues: "minor", major_issues: "major", unsound: "unsound" };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Mark({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={on ? "" : "text-muted line-through opacity-60"}>{children}</span>;
}

function WorkRow({ w, base }: { w: WorkEvidence; base: string }) {
  const reps = w.replications;
  const recs = (Object.keys(RECOMMENDATIONS) as Recommendation[]).filter((k) => w.recommendations[k] > 0);
  return (
    <tr className="break-inside-avoid align-top print:text-[11.5px]">
      <td className="py-2 pr-3 print:py-1.5">
        <a href={`${base}/c/${w.id}`} className="line-clamp-2 font-medium hover:underline">{w.title}</a>
        <div className="text-[11px] text-muted print:text-[10px]">
          {CONTRIBUTION_TYPES[w.type].label} · {w.published_here ? "published on Fjournal" : `published elsewhere${w.venue ? ` (${w.venue})` : ""}`}
          {" "}· {w.first_published.slice(0, 10)} · {plural(w.versions, "version")}
          {w.status === "retracted" && <strong className="ml-1 text-red-700">· RETRACTED</strong>}
          {w.collections.length > 0 && <> · selected by {w.collections.join(", ")}</>}
        </div>
      </td>
      <td className="py-2 pr-3 text-[12px] print:py-1.5 print:text-[11px]">
        {w.reviews === 0 ? (
          <span className="text-muted">none yet</span>
        ) : (
          <>
            {plural(w.reviews, "review")} ({w.reviewers} {w.reviewers === 1 ? "person" : "people"})
            {w.soundness !== null && <div>soundness {w.soundness.toFixed(1)}/5</div>}
            <div className="text-[11px] text-muted print:text-[10px]" title="Reviewers' overall recommendations">
              {recs.map((k) => `${w.recommendations[k]} ${REC_SHORT[k]}`).join(" · ")}
            </div>
          </>
        )}
      </td>
      <td className="py-2 pr-3 text-[12px] print:py-1.5 print:text-[11px]">
        {reps.reproduced + reps.partial + reps.failed === 0 ? (
          <span className="text-muted">none yet</span>
        ) : (
          <>
            {reps.reproduced > 0 && <div className="text-emerald-700 dark:text-emerald-400">{reps.reproduced} reproduced</div>}
            {reps.partial > 0 && <div className="text-amber-700 dark:text-amber-400">{reps.partial} partial</div>}
            {reps.failed > 0 && <div className="text-red-700 dark:text-red-400">{reps.failed} failed</div>}
          </>
        )}
      </td>
      <td className="py-2 pr-3 text-[12px] print:py-1.5 print:text-[11px]">
        <Mark on={w.has_data}>data</Mark> · <Mark on={w.has_code}>code</Mark>
        {w.computationally_reproduced && <div className="text-teal-700 dark:text-teal-400">code re-run ✓</div>}
      </td>
      <td className="py-2 text-[12px] print:py-1.5 print:text-[11px]">
        {w.checks ? <span className={CHECK_TEXT[w.checks][1]}>{CHECK_TEXT[w.checks][0]}</span> : <span className="text-muted">–</span>}
        {w.revised_after_review && <div className="text-[11px]">revised after review</div>}
      </td>
    </tr>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-md border border-line p-3 print:px-2.5 print:py-2">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="space-y-1 text-[13px] leading-5 print:space-y-0.5 print:text-[11.5px] print:leading-4">{children}</div>
    </section>
  );
}

export function ScrutinyReport({
  data,
  base,
  frozen,
}: {
  data: ReportData;
  base: string;
  frozen?: { id: string; hash: string; intact: boolean };
}) {
  const r = data.researcher;
  const w = data.works;
  const rv = data.reviewing;
  const types = (Object.entries(w.by_type) as [ContributionType, number][]).sort((a, b) => b[1] - a[1]);
  const recs = (Object.keys(RECOMMENDATIONS) as Recommendation[]).filter((k) => rv.recommendations[k] > 0);

  return (
    <article className="report mx-auto max-w-[210mm] space-y-4 bg-surface p-6 text-ink shadow-sm print:max-w-none print:space-y-2.5 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start gap-4 border-b-2 border-ink pb-3 print:pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Fjournal scrutiny report</p>
          <h1 className="font-serif text-2xl font-bold leading-tight print:text-xl">{r.name}</h1>
          <p className="text-[13px] text-muted">
            @{r.handle}
            {r.affiliation && <> · {r.affiliation}</>} · on Fjournal since {fmtDay(r.member_since)}
          </p>
          <p className="text-[12px]">
            {r.orcid ? (
              <>ORCID <a href={`https://orcid.org/${r.orcid}`} className="font-mono underline">{r.orcid}</a> (verified by signing in with ORCID)</>
            ) : (
              <span className="text-muted">Identity not verified through ORCID</span>
            )}
          </p>
        </div>
        <div className="text-right text-[12px]">
          <p className="font-semibold">
            {data.period.years ? `Last ${data.period.years} years` : "Whole record"}
          </p>
          <p className="text-muted">
            {data.period.from ? `${fmtDay(data.period.from)} – ` : "up to "}
            {fmtDay(data.period.to)}
          </p>
          {frozen ? (
            <p className="mt-1">
              Verify: <a href={`${base}/report/${frozen.id}`} className="font-mono underline">{base.replace(/^https?:\/\//, "")}/report/{frozen.id}</a>
              <br />
              <span className="font-mono text-[10px] text-muted">sha256 {frozen.hash.slice(0, 32)}…</span>
            </p>
          ) : (
            <p className="mt-1 text-muted">Live view, generated {fmtDay(data.generated_at)}</p>
          )}
        </div>
      </header>

      {data.statement && (
        <section className="break-inside-avoid border-l-4 border-line pl-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">In their own words · self-reported, not verified</h2>
          <p className="whitespace-pre-line font-serif text-[14px] leading-6 print:text-[12px] print:leading-[16px]">{data.statement}</p>
        </section>
      )}

      <section>
        <h2 className="mb-1 font-serif text-lg font-semibold print:text-[15px]">
          {data.highlights.chosen_by === "researcher" ? "Works they chose to be judged on" : "Most scrutinized works"}
          <span className="ml-2 text-[11px] font-normal text-muted">
            {data.highlights.chosen_by === "researcher" ? "chosen by the researcher, shown with all their evidence" : "chosen automatically: no highlights selected"}
          </span>
        </h2>
        {data.highlights.works.length === 0 ? (
          <p className="text-[13px] text-muted">No works yet.</p>
        ) : (
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="border-b border-line text-[11px] text-muted">
              <tr>
                <th className="w-[40%] py-1 pr-3 font-medium">Work</th>
                <th className="py-1 pr-3 font-medium">Public review</th>
                <th className="py-1 pr-3 font-medium">Independent replications</th>
                <th className="py-1 pr-3 font-medium">Openness</th>
                <th className="py-1 font-medium">Automated checks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.highlights.works.map((x) => <WorkRow key={x.id} w={x} base={base} />)}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
        <Box title={`Work (${w.total})`}>
          <p>{types.map(([t, n]) => `${n} ${CONTRIBUTION_TYPES[t].label.toLowerCase()}`).join(", ") || "None in this period."}</p>
          {w.total > 0 && (
            <>
              <p>{w.published_here} published here · {w.published_elsewhere} elsewhere (authorship verified)</p>
              <p>{w.reviewed} publicly reviewed · {w.revised_after_review} revised after review</p>
              <p>{w.open} with open data and code · {w.computationally_reproduced} code re-run by the bot</p>
              <p>
                {w.replicated} independently replicated
                {w.failed_replication > 0 && <> · <span className="text-red-700 dark:text-red-400">{w.failed_replication} with a failed replication</span></>}
              </p>
              {w.selected_by_collections > 0 && <p>{w.selected_by_collections} selected by an editorial board</p>}
            </>
          )}
        </Box>
        <Box title={`Reviewing others' work (${rv.reviews})`}>
          {rv.reviews === 0 ? (
            <p className="text-muted">No public reviews in this period.</p>
          ) : (
            <>
              <p>
                {plural(rv.reviews, "signed public review")} of {plural(rv.works, "work")}, {rv.helpful_votes} helpful vote{rv.helpful_votes === 1 ? "" : "s"} from readers
              </p>
              <p className="text-muted">
                {recs.map((k) => `${rv.recommendations[k]} ${RECOMMENDATIONS[k].toLowerCase()}`).join(" · ")}
                {rv.with_doi > 0 && <> · {rv.with_doi} with a DOI</>}
                {rv.of_work_published_elsewhere > 0 && <> · {rv.of_work_published_elsewhere} of work published elsewhere</>}
              </p>
              <p className="text-[12px]">Read the most helpful:</p>
              <ul className="list-disc pl-4 text-[12px]">
                {rv.most_helpful.map((x) => (
                  <li key={x.id}>
                    <a href={`${base}/r/${x.id}`} className="underline">review of &ldquo;{x.title}&rdquo;</a>
                    {x.doi ? <> · doi:{x.doi}</> : null} · {x.helpful} helpful
                  </li>
                ))}
              </ul>
            </>
          )}
        </Box>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        <Box title={`Replications they performed (${data.replications_performed.length})`}>
          {data.replications_performed.length === 0 ? (
            <p className="text-muted">None in this period.</p>
          ) : (
            <ul className="space-y-0.5 text-[12px]">
              {data.replications_performed.slice(0, 3).map((x) => (
                <li key={x.id}>
                  <strong>{x.outcome === "reproduced" ? "Reproduced" : x.outcome === "partial" ? "Partially reproduced" : x.outcome === "failed" ? "Failed to reproduce" : "Replicated"}</strong>:{" "}
                  <a href={`${base}/c/${x.of_id}`} className="underline">{x.of_title}</a>
                </li>
              ))}
              {data.replications_performed.length > 3 && <li className="text-muted">and {data.replications_performed.length - 3} more</li>}
            </ul>
          )}
        </Box>
        <Box title="Editorial service">
          {data.editorial.length === 0 ? (
            <p className="text-muted">No editorial board service on Fjournal.</p>
          ) : (
            <ul className="space-y-0.5 text-[12px]">
              {data.editorial.slice(0, 3).map((e) => (
                <li key={e.slug}>
                  {e.role === "managing" ? "Managing editor" : "Editor"}{e.current ? "" : " (former)"},{" "}
                  <a href={`${base}/j/${e.slug}`} className="underline">{e.collection}</a> · {plural(e.decisions, "public decision")}
                </li>
              ))}
              {data.editorial.length > 3 && <li className="text-muted">and {data.editorial.length - 3} more boards</li>}
            </ul>
          )}
        </Box>
        <Box title="Integrity record">
          {data.integrity.retracted.length === 0 && data.integrity.removed_by_moderation === 0 ? (
            <p>No retractions. Nothing they posted has been removed by moderation.</p>
          ) : (
            <>
              {data.integrity.retracted.map((x) => (
                <p key={x.id} className="text-red-800 dark:text-red-300">
                  Retracted for {x.reason.toLowerCase()}: <a href={`${base}/c/${x.id}`} className="underline">{x.title}</a>
                  {x.log_seq && <> (<a href={`${base}/moderation/${x.log_seq}`} className="underline">public decision #{x.log_seq}</a>)</>}
                </p>
              ))}
              {data.integrity.removed_by_moderation > 0 && (
                <p>{plural(data.integrity.removed_by_moderation, "item")} removed by moderation (spam, abuse or similar), each with a public log entry.</p>
              )}
            </>
          )}
        </Box>
      </div>

      <footer className="space-y-1 border-t border-line pt-2 text-[10.5px] leading-4 text-muted print:break-inside-avoid print:text-[9.5px] print:leading-[12px]">
        <p>
          <strong className="text-ink">How to read this.</strong> Every figure comes from public, signed records on Fjournal that you can open:
          reviews are scored 1–5 by named reviewers and averaged with a weight that grows logarithmically with each
          reviewer&apos;s track record; failed replications and retractions are shown because they are information, not
          because they are rare. Nothing here was chosen by the researcher except the statement and the highlighted works.
        </p>
        <p>
          <strong className="text-ink">Deliberately left out:</strong> journal names as a mark of quality, impact factors,
          citation counts, h-indices, institutional prestige and any single overall score, in line with DORA and CoARA.
          Read the work and its reviews instead. Full record: <a href={`${base}/u/${r.handle}`} className="underline">{base.replace(/^https?:\/\//, "")}/u/{r.handle}</a>.
        </p>
        <p className="font-mono">
          Ledger {data.ledger.verified ? "verified" : "FAILED verification"} at generation · versions {data.ledger.version_head.slice(0, 12)} · reviews{" "}
          {data.ledger.review_head.slice(0, 12)} · collections {data.ledger.collection_head.slice(0, 12)}
          {frozen && !frozen.intact && <strong className="text-red-700"> · THIS SNAPSHOT DOES NOT MATCH ITS HASH</strong>}
        </p>
      </footer>
    </article>
  );
}
