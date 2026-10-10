import Link from "next/link";
import type { Collection } from "@/lib/collections";
import { onAccent } from "@/lib/color";

export function LineageNote({ c, board, verified }: { c: Collection; board: number; verified: number }) {
  if (!c.continues) return null;
  const l = c.continues;
  return (
    <p className="text-sm">
      Continues the community of <strong>{l.journal}</strong>
      {l.publisher && <> ({l.publisher})</>}, whose editorial board moved here{l.year ? ` in ${l.year}` : ""}.{" "}
      <span className="opacity-80">
        Claimed by the board:{" "}
        <a href={l.statement_url} target="_blank" rel="noreferrer nofollow" className="font-semibold underline">read their statement</a>. {verified} of{" "}
        {board} board member{board === 1 ? "" : "s"} verified through ORCID.
      </span>
    </p>
  );
}

export function CollectionHeader({
  c,
  tab,
  isBoard,
  board,
  verified,
}: {
  c: Collection;
  tab: "home" | "log" | "desk";
  isBoard: boolean;
  board: number;
  verified: number;
}) {
  const ink = onAccent(c.accent);
  const tabs: [typeof tab, string, string][] = [
    ["home", "Collection", `/j/${c.slug}`],
    ["log", "Decisions & board log", `/j/${c.slug}/log`],
    ...(isBoard ? ([["desk", "Editorial desk", `/j/${c.slug}/desk`]] as [typeof tab, string, string][]) : []),
  ];
  return (
    <header className="overflow-hidden rounded-lg border border-line">
      <div className="space-y-2 px-6 py-8" style={{ background: c.accent, color: ink }}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
          <Link href="/collections" className="hover:underline">Collection on Fjournal</Link>
        </p>
        <h1 className="font-serif text-3xl font-bold leading-tight sm:text-4xl">{c.name}</h1>
        {c.tagline && <p className="max-w-3xl text-base opacity-90">{c.tagline}</p>}
        <LineageNote c={c} board={board} verified={verified} />
      </div>
      <nav className="flex flex-wrap gap-1 bg-surface px-3">
        {tabs.map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "font-semibold" : "border-transparent text-muted hover:text-ink"}`}
            style={tab === key ? { borderColor: c.accent } : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
