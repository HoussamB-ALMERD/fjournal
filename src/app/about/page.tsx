import Link from "next/link";
import { BADGE_RULES } from "@/lib/scrutiny";
import { POINTS } from "@/lib/reputation";
import { AUTHOR_LICENSES, LICENSES } from "@/lib/constants";

export const metadata = { title: "How it works" };

const REP_ROWS: [keyof typeof POINTS, string][] = [
  ["contribution", "Publish a contribution"],
  ["negative_result", "Publish a negative result (same as a positive one — on purpose)"],
  ["replication_published", "Publish a replication of someone else's work (any outcome)"],
  ["replicated_by_others", "Your work is independently reproduced"],
  ["review_helpful", "Someone marks your review helpful (× their weight)"],
  ["endorsement_received", "Someone endorses your work (× their weight)"],
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <header className="space-y-4">
        <h1 className="font-serif text-4xl font-bold">How Fjournal works</h1>
        <p className="text-lg leading-8 text-muted">
          Journals sell a brand. The brand stands in for a judgement made privately by three or four people. Fjournal
          replaces that with something stronger: an open, permanent, auditable record of how a piece of work held up
          when the whole community looked at it.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">The commitments</h2>
        <ul className="space-y-3 leading-7">
          <li><strong>Zero fees, forever.</strong> No article processing charges. No subscriptions. There is no payment code in the platform.</li>
          <li><strong>Publish immediately.</strong> No editor decides whether your work &ldquo;fits&rdquo;. It goes live when you press publish.</li>
          <li><strong>You keep your copyright.</strong> Choose a license with one click. Fjournal only needs permission to host and display.</li>
          <li><strong>No credential gate.</strong> Degrees and affiliations are optional and never enter any score.</li>
          <li><strong>Everything is versioned.</strong> Every version stays public, with its reviews, forever.</li>
          <li><strong>Negative results and replications are first-class.</strong> They earn the same or more reputation than novel claims.</li>
        </ul>
      </section>

      <section className="space-y-3" id="review">
        <h2 className="font-serif text-2xl font-semibold">Open review instead of a private veto</h2>
        <p className="leading-7">
          Anyone with an account can review any contribution. Reviews are signed, public, attached to the exact version
          they evaluated, and scored on four axes: soundness, reproducibility, clarity and significance. No single
          review can block anything. Instead, the community marks reviews as <em>helpful</em> — and only helpful reviews
          earn the reviewer reputation. A drive-by &ldquo;reject&rdquo; earns nothing.
        </p>
        <p className="leading-7">
          Authors respond by posting improved versions. The full trail — critique, response, revision — is the
          evidence of quality.
        </p>
      </section>

      <section className="space-y-3" id="import">
        <h2 className="font-serif text-2xl font-semibold">Review any paper, wherever it was published</h2>
        <p className="leading-7">
          Open review isn&apos;t limited to work published here. Anyone can{" "}
          <Link href="/import" className="text-accent underline">open any paper for review</Link>: an arXiv preprint,
          a bioRxiv or medRxiv preprint, a journal article by its DOI, or a dataset. The paper gets the same public
          reviews, replications, discussion and automated statistics checks as everything else. The full text stays at
          the source, and nobody owns the record. Fjournal doesn&apos;t replace the place a paper was printed. It shows
          whether the paper holds up.
        </p>
      </section>

      <section className="space-y-3" id="reproducibility">
        <h2 className="font-serif text-2xl font-semibold">We re-run the code</h2>
        <p className="leading-7">
          When work comes with code pinned to a commit and a small <code>fjournal.json</code> declaring which results it
          produces, the <Link href="/tools/reproduce" className="text-accent underline">reproducibility bot</Link> runs it
          again from scratch, in an isolated sandbox with no network access, and compares every number. Work where every
          result comes out the same earns the <em>Computationally reproduced</em> badge. The log, the environment and a hash
          of the outcome are public. Not trust: verification.
        </p>
      </section>

      <section className="space-y-3" id="journal-index">
        <h2 className="font-serif text-2xl font-semibold">Turning the scrutiny around</h2>
        <p className="leading-7">
          The <Link href="/journals" className="text-accent underline">Journal Integrity Index</Link> measures journals the way
          journals never measured themselves. It looks at a random sample of a journal&apos;s articles: whether reported statistics
          contradict themselves, whether the data is available, whether articles are openly licensed, and how many articles were
          later retracted, and how fast. Each figure comes with its uncertainty and a baseline for its field. There is no overall
          score and no league table, every number traces to the articles behind it, journals can reply, and anyone can request a
          correction. The <Link href="/journals/method" className="text-accent underline">method</Link> is published first,
          and results only go public after it has been reviewed.
        </p>
      </section>

      <section className="space-y-3" id="scrutiny-report">
        <h2 className="font-serif text-2xl font-semibold">A one-page report for hiring committees</h2>
        <p className="leading-7">
          Every member has a printable scrutiny report: how their work held up when the community examined it, and what
          they gave back as a reviewer, replicator and editor. It shows failed replications and retractions as plainly as
          successes, because committees need the whole record. It leaves out what research-assessment reform asks
          committees to stop using: journal names as a proxy for quality, impact factors, citation counts, h-indices and
          any single score. The researcher adds only a short statement and the works they want to be judged on. A frozen
          copy carries a link and a hash, so a committee can check that the page it received is genuine.
        </p>
      </section>

      <section className="space-y-3" id="collections">
        <h2 className="font-serif text-2xl font-semibold">Collections: a home for editorial boards</h2>
        <p className="leading-7">
          Editorial boards keep resigning from journals over fees and publisher control. A{" "}
          <Link href="/collections" className="text-accent underline">collection</Link> lets a board bring its name,
          scope and standards here at no cost. The board selects work in public: every decision is signed, explained
          against published criteria, declares competing interests, rests on a minimum number of public reviews, and is
          pinned to the exact version it judged. Editors can&apos;t decide on their own work, and authors can withdraw at
          any time. Every board change and decision is hash-chained like the rest of the ledger. Selection is a
          board&apos;s judgement, not evidence, so it earns no reputation and sits apart from the badges. Nothing needs a
          board to be published.
        </p>
      </section>

      <section className="space-y-3" id="citable-reviews">
        <h2 className="font-serif text-2xl font-semibold">Reviews are publications</h2>
        <p className="leading-7">
          Journals take reviewers&apos; work for free and credit it to no one. Here every review has a permanent page,
          is hashed into its own public chain so it can never be edited or backdated, carries a license its reviewer
          chooses, and can be cited in BibTeX, RIS or CSL. A reviewer can register a DOI for any review they wrote. It is
          recorded with DataCite as a peer review of the work, linked to their verified ORCID iD, so it counts on a CV
          like any paper. Sign in with ORCID to prove who you are without any credential gate. If you wrote a paper that
          someone imported, your ORCID record lets you claim it.
        </p>
      </section>

      <section className="space-y-3" id="badges">
        <h2 className="font-serif text-2xl font-semibold">Badges: public rules, no brand</h2>
        <div className="card divide-y divide-line">
          {BADGE_RULES.map((b) => (
            <div key={b.key} className="flex gap-4 p-4 text-sm">
              <strong className="w-28 shrink-0">{b.label}</strong>
              <span>{b.rule}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Scores are weighted by each reviewer&apos;s reputation using <code>1 + log10(1 + reputation)</code>: established
          contributors count more, newcomers still count, and no small group can dominate.
        </p>
      </section>

      <section className="space-y-3" id="reputation">
        <h2 className="font-serif text-2xl font-semibold">Reputation is earned, not conferred</h2>
        <div className="card divide-y divide-line">
          {REP_ROWS.map(([k, label]) => (
            <div key={k} className="flex justify-between gap-4 p-4 text-sm">
              <span>{label}</span>
              <span className="font-mono">+{POINTS[k]}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Reputation is an append-only ledger of events; your score is their sum. You cannot review, endorse or
          replicate your own work, or vote on your own reviews.
        </p>
      </section>

      <section className="space-y-3" id="integrity">
        <h2 className="font-serif text-2xl font-semibold">Integrity: data, not trust</h2>
        <p className="leading-7">
          Every version is checked automatically, and the results are public. We recompute reported p-values from their
          test statistics, test whether reported means are possible for the sample size (GRIM), fingerprint every figure
          and compare it with every other figure on Fjournal (including mirrored copies), and confirm that linked data and
          code still match their pinned checksum, commit or DOI. A flag is a prompt for human attention, never an
          automatic penalty. Anyone can also run the <Link href="/tools/check" className="text-accent underline">statistics checker</Link> on
          any paper, from any journal.
        </p>
        <p className="leading-7">
          Every version declares its funding and competing interests, and every reviewer declares theirs. These
          declarations are part of the version&apos;s hashed, permanent record.
        </p>
      </section>

      <section className="space-y-3" id="moderation">
        <h2 className="font-serif text-2xl font-semibold">Moderation: narrow, public, appealable</h2>
        <p className="leading-7">
          Content is moderated only for fabrication, plagiarism, spam, harassment, exposing private data, or unlawful
          content. <strong>Never for disagreement.</strong> Fraud and plagiarism lead to a <em>retraction</em>: the work stays
          readable with a notice, because the record of what was claimed matters. Every decision is published in the{" "}
          <Link href="/moderation" className="text-accent underline">moderation log</Link> under the moderator&apos;s name, with
          evidence. Moderators can&apos;t act on anything attached to their own work, and appeals always go to a different moderator.
        </p>
      </section>

      <section className="space-y-3" id="priority">
        <h2 className="font-serif text-2xl font-semibold">Proof of priority</h2>
        <p className="leading-7">
          Every version is hashed (SHA-256 over its canonical content) and appended to a single platform-wide hash
          chain. Each version comes with a downloadable <em>priority receipt</em> containing the content and hashes,
          and the <Link href="/ledger" className="text-accent underline">full ledger</Link> is public for anyone to
          mirror and verify. If anyone altered or backdated a single entry, every later hash would break.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">Licenses</h2>
        <div className="card divide-y divide-line">
          {AUTHOR_LICENSES.map((k) => LICENSES[k]).map((l) => (
            <div key={l.label} className="flex gap-4 p-4 text-sm">
              <strong className="w-40 shrink-0">{l.label}</strong>
              <span>{l.summary}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="flex gap-3">
        <Link href="/submit" className="btn">Publish your work</Link>
        <Link href="/?sort=needs-review" className="btn-ghost">Start reviewing</Link>
      </div>
    </div>
  );
}
