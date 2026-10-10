import Link from "next/link";
import { feed, platformStats, topContributors, type FeedOrigin, type FeedSort } from "@/lib/queries";
import { CONTRIBUTION_TYPES, type ContributionType } from "@/lib/constants";
import { FeedCard } from "@/components/FeedCard";

const TABS: { key: FeedSort; label: string }[] = [
  { key: "latest", label: "Latest" },
  { key: "needs-review", label: "Needs review" },
  { key: "most-scrutinized", label: "Most scrutinized" },
  { key: "replications-negative", label: "Replications & negative results" },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const sort = (TABS.find((t) => t.key === sp.sort)?.key ?? "latest") as FeedSort;
  const type = typeof sp.type === "string" && sp.type in CONTRIBUTION_TYPES ? (sp.type as ContributionType) : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : undefined;
  const origin = sp.origin === "fjournal" || sp.origin === "imported" ? (sp.origin as FeedOrigin) : undefined;
  const items = await feed({ sort, type, q, origin });
  const stats = await platformStats();
  const top = await topContributors(8);

  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { sort, type, q, origin, ...o };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "sort" && v === "latest")) p.set(k, v);
    const s = p.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div className="space-y-10">
      <section className="grid gap-8 border-b border-line pb-10 lg:grid-cols-[1fr_320px]">
        <div>
          <h1 className="font-serif text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Science, judged in the open.
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-muted">
            Publish in minutes. Keep your copyright. Get evaluated by the whole community — not by three anonymous
            gatekeepers. Replications and negative results count. No degree required. No fees, ever. Science belongs to the people who do it — not to the publishers who sell it back to them.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/submit" className="btn">Publish your work</Link>
            <Link href="/import" className="btn-ghost">Review any paper, from any journal</Link>
            <Link href="/manifesto" className="btn-ghost">Why we exist</Link>
          </div>
        </div>
        <dl className="card grid grid-cols-2 gap-4 self-start p-5 text-center">
          {[
            ["Contributions", stats.contributions],
            ["Versions", stats.versions],
            ["Public reviews", stats.reviews],
            ["Replications", stats.replications],
          ].map(([k, v]) => (
            <div key={k}>
              <dd className="font-serif text-3xl font-semibold">{v}</dd>
              <dt className="text-xs text-muted">{k}</dt>
            </div>
          ))}
          <p className="col-span-2 border-t border-line pt-3 text-xs text-muted">
            Fees paid by authors: <strong className="text-ink">$0</strong> · by readers: <strong className="text-ink">$0</strong>
          </p>
        </dl>
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2 border-b border-line">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={href({ sort: t.key })}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${sort === t.key ? "border-accent font-semibold" : "border-transparent text-muted hover:text-ink"}`}
              >
                {t.label}
              </Link>
            ))}
          </div>
          <form className="flex gap-2" action="/">
            {sort !== "latest" && <input type="hidden" name="sort" value={sort} />}
            <input className="input" name="q" defaultValue={q} placeholder="Search titles, abstracts, authors…" />
            <select className="input w-48" name="type" defaultValue={type ?? ""}>
              <option value="">All types</option>
              {Object.entries(CONTRIBUTION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <select className="input w-44" name="origin" defaultValue={origin ?? ""}>
              <option value="">All origins</option>
              <option value="fjournal">Published here</option>
              <option value="imported">Imported for review</option>
            </select>
            <button className="btn-ghost">Filter</button>
          </form>
          {items.length === 0 ? (
            <div className="card p-10 text-center text-muted">
              Nothing here yet. <Link href="/submit" className="text-accent underline">Be the first to publish.</Link>
            </div>
          ) : (
            items.map((it) => <FeedCard key={it.id} item={it} />)
          )}
        </section>

        <aside className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Top contributors</h2>
            {top.length === 0 ? (
              <p className="text-sm text-muted">Reputation is earned by publishing, reviewing well and replicating.</p>
            ) : (
              <ol className="space-y-2 text-sm">
                {top.map((u, i) => (
                  <li key={u.handle} className="flex items-center gap-2">
                    <span className="w-4 text-xs text-muted">{i + 1}</span>
                    <Link href={`/u/${u.handle}`} className="truncate hover:text-accent">{u.display_name}</Link>
                    <span className="ml-auto font-mono text-xs text-muted">{u.rep}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="card space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Badges mean something</h2>
            <p className="text-muted">
              Every badge follows a public rule anyone can audit. No brand, no impact factor — just evidence.
            </p>
            <Link href="/about#badges" className="text-accent underline">See the rules</Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
