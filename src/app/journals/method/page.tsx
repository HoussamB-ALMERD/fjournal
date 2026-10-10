import Link from "next/link";
import { indexPublic } from "@/lib/index/index";
import {
  DATA_CLASSES,
  INDICATORS,
  METHOD_VERSION,
  MIN_ARTICLES_FOR_RATES,
  MIN_JOURNALS_FOR_BASELINE,
  MIN_SAMPLE,
  SHARED,
  type DataClass,
  type IndicatorKey,
} from "@/lib/index/method";

export const metadata = { title: "Journal Integrity Index: method" };

export default function MethodPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          <Link href="/journals" className="hover:underline">Journal Integrity Index</Link> · method {METHOD_VERSION}
        </p>
        <h1 className="font-serif text-4xl font-bold">How journals are measured</h1>
        <p className="text-lg leading-8 text-muted">
          The method is published before any result, so it can be criticised first. Status:{" "}
          <strong className="text-ink">{indexPublic() ? "results public" : "draft method, results not yet public"}</strong>.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">What it is, and what it isn&apos;t</h2>
        <ul className="list-disc space-y-2 pl-5 leading-7">
          <li>It describes, with stated uncertainty, a few measurable properties of a sample of a journal&apos;s articles.</li>
          <li>
            It is <strong>not a ranking and has no overall score</strong>. Journals are listed alphabetically. Combining
            different indicators into one number would hide exactly what readers need to see.
          </li>
          <li>
            It is <strong>not an accusation</strong>. A statistical inconsistency is usually a typo. A missing data statement may
            reflect a field&apos;s norms. A retraction can be a sign of good editorial practice.
          </li>
          <li>
            <strong>Fjournal is not neutral</strong>: it is an alternative to journals. That is why everything here can be
            checked independently, down to each sampled article, and why journals have a right of reply and anyone can request
            corrections.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Sampling</h2>
        <p className="leading-7">
          For each journal, a publication window is chosen that ends at least a year ago, so retractions have had time to happen.
          The total number of journal articles in the window comes from Crossref. A uniform random sample of those articles is
          drawn through Crossref&apos;s sampling API (typically 200); correction and retraction notices that Crossref types as
          articles are skipped, though they remain in the total used for retraction rates. Each sampled article&apos;s licence is read from its Crossref
          record. Its full text is read only where an open machine-readable copy exists (Europe PMC). The text is analysed in memory and
          never stored or republished; only the measurements and short quotations are kept, with email addresses removed.
        </p>
        <p className="leading-7">
          The sample of articles with open full text is not random with respect to openness. Indicators that need full text
          describe a journal&apos;s openly available articles, and the page says how many those were.
        </p>
      </section>

      <section className="space-y-6">
        <h2 className="font-serif text-2xl font-semibold">The four indicators</h2>
        {(Object.keys(INDICATORS) as IndicatorKey[]).map((k) => (
          <div key={k} className="space-y-1">
            <h3 className="font-semibold">{INDICATORS[k].label}</h3>
            <p className="leading-7">{INDICATORS[k].question}</p>
            <p className="text-sm text-muted">{INDICATORS[k].caution}</p>
            {k === "statistics" && (
              <p className="text-sm leading-6">
                Tests are recomputed from the reported statistic and degrees of freedom, allowing for rounding (the statcheck
                method). An inconsistency &ldquo;flips significance&rdquo; when the reported p and the recomputed p fall on
                different sides of 0.05. The same test quoted twice in an article counts once.
              </p>
            )}
            {k === "data" && (
              <ul className="list-disc pl-5 text-sm leading-6">
                {(Object.keys(DATA_CLASSES) as DataClass[]).map((c) => (
                  <li key={c}>
                    <strong>{c}</strong>: {DATA_CLASSES[c]}
                    {SHARED.includes(c) && " — counted as shared"}
                  </li>
                ))}
              </ul>
            )}
            {k === "retractions" && (
              <p className="text-sm leading-6">
                Retraction notices registered with Crossref for the journal (by the publisher or from Retraction Watch) are traced
                to the original articles. Those published in the window are counted, and the time from publication to the first
                notice is recorded. Expressions of concern are counted the same way.
              </p>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Uncertainty, minimum samples and baselines</h2>
        <ul className="list-disc space-y-2 pl-5 leading-7">
          <li>Every proportion carries a 95% Wilson score interval.</li>
          <li>
            Sample-based indicators need at least {MIN_SAMPLE} eligible articles; retraction rates need at least{" "}
            {MIN_ARTICLES_FOR_RATES.toLocaleString("en")} articles in the window. Below that, &ldquo;insufficient data&rdquo; is
            shown instead of a number.
          </li>
          <li>
            Field baselines pool the counts of every assessed journal in the same field, once there are at least{" "}
            {MIN_JOURNALS_FOR_BASELINE}. Fields are assigned by the moderator who runs the sweep and shown on each page.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Process and accountability</h2>
        <ol className="list-decimal space-y-2 pl-5 leading-7">
          <li>A moderator runs a sweep. The result is a draft, attributed to them.</li>
          <li>A <strong>different</strong> moderator checks it and publishes it. Its measurements are then hashed, and the page shows whether they have changed since.</li>
          <li>
            <strong>Right of reply:</strong> someone who speaks for the journal can reply. Once a moderator has confirmed their
            identity, the reply is published verbatim next to the figures, with a note of how identity was checked.
          </li>
          <li>
            <strong>Corrections:</strong> anyone can request one, publicly. If it is accepted, the article is removed from that
            indicator and the figure updates. Both the request and its resolution stay on the page.
          </li>
          <li>Assessments can be withdrawn, with a public reason. Method changes get a new version number, and every assessment records the version it used.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Known limitations</h2>
        <ul className="list-disc space-y-2 pl-5 leading-7">
          <li>Only APA-style reporting is read, so many fields will show &ldquo;insufficient data&rdquo; for statistics.</li>
          <li>Data statements are classified by text patterns. Each classification is shown with the quoted statement so errors can be corrected.</li>
          <li>Retraction notices that aren&apos;t linked to the article in Crossref are missed.</li>
          <li>Articles behind paywalls are only measured for licence and retractions.</li>
        </ul>
      </section>
    </article>
  );
}
