import Link from "next/link";
import { listCollections } from "@/lib/collections";
import { onAccent } from "@/lib/color";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const collections = listCollections();
  return (
    <div className="space-y-10">
      <section className="grid gap-8 border-b border-line pb-10 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight">Bring your board. Keep your community. Drop the publisher.</h1>
          <p className="max-w-2xl text-lg leading-8 text-muted">
            Editorial boards keep resigning from journals over fees and publisher control. A collection gives a board a
            home with its own name, scope and standards, at no cost to anyone. The board selects work in public, with
            signed reasoning, on top of open review. Publishing never depends on the board: every work stays published
            and reviewable whether or not anyone selects it.
          </p>
          <Link href="/collections/new" className="btn">Found a collection</Link>
        </div>
        <ul className="card space-y-3 self-start p-5 text-sm">
          <li><strong>Accountable boards.</strong> Members, roles and every change to them are public and hash-chained.</li>
          <li><strong>Reasoned decisions.</strong> Each one is signed, explained, declares competing interests and is pinned to the exact version and the policy in force.</li>
          <li><strong>Evidence first.</strong> Selection needs the public reviews the collection&apos;s policy promises. Editors can&apos;t decide on their own work.</li>
          <li><strong>Authors in control.</strong> They can withdraw at any time. Selection earns no reputation: the scrutiny record stays the signal.</li>
          <li><strong>Portable.</strong> The whole collection, log included, is exportable through the open API.</li>
        </ul>
      </section>

      {collections.length === 0 ? (
        <div className="card p-10 text-center text-muted">
          No collections yet. <Link href="/collections/new" className="text-accent underline">Found the first one.</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map((c) => (
            <Link key={c.id} href={`/j/${c.slug}`} className="card overflow-hidden transition hover:border-ink/30">
              <div className="px-5 py-4" style={{ background: c.accent, color: onAccent(c.accent) }}>
                <h2 className="font-serif text-xl font-bold">{c.name}</h2>
                {c.tagline && <p className="text-sm opacity-90">{c.tagline}</p>}
              </div>
              <div className="space-y-2 p-5 text-sm">
                {c.continues && (
                  <p>
                    Continues <strong>{c.continues.journal}</strong>
                    {c.continues.year && <> since {c.continues.year}</>}
                  </p>
                )}
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{c.selected} selected</span>
                  <span>{c.considering} under consideration</span>
                  <span>board of {c.board} ({c.verified} ORCID-verified)</span>
                  <span>≥{c.min_reviews} public review{c.min_reviews === 1 ? "" : "s"} to select</span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
