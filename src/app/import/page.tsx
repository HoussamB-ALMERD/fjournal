import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { feed } from "@/lib/queries";
import { ImportForm } from "@/components/forms";
import { FeedCard } from "@/components/FeedCard";

export const metadata = { title: "Review any paper" };

const SOURCES = [
  ["arXiv", "Any arXiv ID or link, including a specific version (2310.06825v2)."],
  ["bioRxiv & medRxiv", "Any preprint DOI or link. New versions at the server can be pulled in later."],
  ["Journal articles", "Any DOI registered with Crossref — every major publisher."],
  ["Data & software", "DOIs from DataCite repositories such as Zenodo, Figshare and OSF."],
];

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const sp = await searchParams;
  const me = await currentUser();
  const recent = await feed({ origin: "imported", limit: 10 });
  const initial = typeof sp.id === "string" ? sp.id.slice(0, 500) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-4">
        <h1 className="font-serif text-4xl font-bold">Review any paper</h1>
        <p className="text-lg leading-8 text-muted">
          A journal&apos;s verdict comes from a few people in private, once. Here the whole community can review
          any paper, wherever it was published, in public and for as long as it matters. Paste an identifier and the
          paper gets a page for open reviews, replications, discussion and automated statistics checks.
        </p>
      </header>

      <section className="card p-5">
        {me ? (
          <ImportForm initial={initial} />
        ) : (
          <p className="text-sm text-muted">
            <Link href={`/login?next=/import`} className="text-accent underline">Sign in</Link> to open a paper for review.
            Reading every review on Fjournal needs no account.
          </p>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {SOURCES.map(([name, hint]) => (
          <div key={name} className="card p-4 text-sm">
            <strong className="block">{name}</strong>
            <span className="text-muted">{hint}</span>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold">What happens when you import a paper</h2>
        <ul className="list-disc space-y-2 pl-5 leading-7">
          <li>
            Fjournal records the title, authors, abstract and source as a timestamped snapshot in the{" "}
            <Link href="/ledger" className="text-accent underline">public ledger</Link>, so every review points at
            exactly what was reviewed. The full text stays at the source. We link to it and don&apos;t copy it.
          </li>
          <li>
            Nobody owns the record. You get no authorship credit for importing, and nobody can edit it. If the source
            posts a new version, anyone can pull it in as a new version here.
          </li>
          <li>
            Where an open machine-readable full text exists (arXiv HTML, bioRxiv/medRxiv, Europe PMC), the{" "}
            <Link href="/about#integrity" className="text-accent underline">statistics checks</Link> run on the whole paper.
            Publisher retractions and corrections are shown as they are registered with Crossref.
          </li>
          <li>
            Reviews of imported papers earn reputation exactly like any other review. So do replications of them.
          </li>
          <li>
            Fjournal never retracts work it doesn&apos;t publish. Evidence of a problem goes into a public review,
            where it stays attached to the paper.
          </li>
        </ul>
      </section>

      {recent.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-semibold">Recently opened for review</h2>
          {recent.map((it) => (
            <FeedCard key={it.id} item={it} />
          ))}
        </section>
      )}
    </div>
  );
}
