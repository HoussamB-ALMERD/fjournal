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

  const figures: [string, number | string][] = [
    ["Contributions", stats.contributions],
    ["Public reviews", stats.reviews],
    ["Replications", stats.replications],
    ["Versions on the ledger", stats.versions],
    ["Fees, to anyone", "$0"],
  ];

  return (
    <div>
      <section className="pt-6 pb-12 sm:pt-10">
        <p className="kicker">An open journal for every field</p>
        <h1 className="mt-4 max-w-4xl font-serif text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.02em] text-balance sm:text-6xl">
          Science, judged in the open.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink/80">
          Publish in minutes and keep your copyright. Every review is public, signed and versioned, and replications and
          negative results count as much as new findings. No fees for authors or readers, and no credentials required.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href="/submit" className="btn h-10 px-5">Publish your work</Link>
          <Link href="/import" className="link text-sm font-medium">Review a paper from any journal</Link>
          <Link href="/manifesto" className="link text-sm text-muted">Why we exist</Link>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-5">
        {figures.map(([k, v]) => (
          <div key={k} className="bg-paper py-5 pr-4 sm:pl-5 sm:first:pl-0 max-sm:even:pl-5 max-sm:last:col-span-2">
            <dd className="font-serif text-3xl font-semibold tabular-nums">{v}</dd>
            <dt className="mt-1 text-xs text-muted">{k}</dt>
          </div>
        ))}
      </dl>

      <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_240px]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <nav aria-label="Sort" className="-mb-px flex flex-wrap gap-x-6 gap-y-1">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={href({ sort: t.key })}
                  aria-current={sort === t.key ? "page" : undefined}
                  className={`border-b-2 pb-2 text-sm transition-colors ${sort === t.key ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>
          <form className="mt-5 flex flex-col gap-2 sm:flex-row" action="/" role="search">
            {sort !== "latest" && <input type="hidden" name="sort" value={sort} />}
            <label className="sr-only" htmlFor="feed-q">Search</label>
            <input id="feed-q" className="input min-w-0 sm:flex-1" type="search" name="q" defaultValue={q} placeholder="Search titles, abstracts, authors" />
            <label className="sr-only" htmlFor="feed-type">Type</label>
            <select id="feed-type" className="input sm:w-40" name="type" defaultValue={type ?? ""}>
              <option value="">All types</option>
              {Object.entries(CONTRIBUTION_TYPES).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="feed-origin">Origin</label>
            <select id="feed-origin" className="input sm:w-44" name="origin" defaultValue={origin ?? ""}>
              <option value="">All origins</option>
              <option value="fjournal">Published here</option>
              <option value="imported">Imported for review</option>
            </select>
            <button className="btn-ghost">Search</button>
          </form>
          {items.length === 0 ? (
            <div className="mt-6 border-y border-line py-12">
              <p className="font-serif text-xl">{q || type || origin ? "Nothing matches that search." : "Nothing published yet."}</p>
              <p className="mt-2 text-sm text-muted">
                {q || type || origin ? (
                  <Link href="/" className="link">Clear the filters</Link>
                ) : (
                  <>Publish the first paper, or <Link href="/import" className="link">open an existing one for review</Link>.</>
                )}
              </p>
            </div>
          ) : (
            <div className="mt-6 divide-y divide-line border-y border-line">
              {items.map((it) => <FeedCard key={it.id} item={it} />)}
            </div>
          )}
        </section>

        <aside className="space-y-10 text-sm lg:pt-1">
          <section>
            <h2 className="kicker border-b border-line pb-2">Top contributors</h2>
            {top.length === 0 ? (
              <p className="mt-3 text-muted">Reputation is earned by publishing, reviewing well and replicating.</p>
            ) : (
              <ol className="mt-2">
                {top.map((u, i) => (
                  <li key={u.handle} className="flex items-baseline gap-3 py-1.5">
                    <span className="w-4 text-xs text-faint tabular-nums">{i + 1}</span>
                    <Link href={`/u/${u.handle}`} className="truncate hover:underline">{u.display_name}</Link>
                    <span className="ml-auto text-xs text-muted tabular-nums">{u.rep}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section>
            <h2 className="kicker border-b border-line pb-2">Badges are rules, not brands</h2>
            <p className="mt-3 leading-relaxed text-muted">
              Every badge is awarded by a public rule anyone can audit. No impact factor, no prestige, only evidence.
            </p>
            <Link href="/about#badges" className="link mt-2 inline-block">Read the rules</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
