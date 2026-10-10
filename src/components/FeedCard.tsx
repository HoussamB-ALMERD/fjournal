import Link from "next/link";
import type { FeedItem } from "@/lib/queries";
import { REPLICATION_OUTCOMES } from "@/lib/constants";
import { Badges, CollectionChip, LicenseTag, NoticeTag, ScrutinyLine, SourceTag, TypeTag, seriousNotices, timeAgo } from "./ui";

export function FeedCard({ item }: { item: FeedItem }) {
  return (
    <article className="card p-5 transition hover:border-ink/30">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TypeTag type={item.type} />
        {item.source && <SourceTag source={item.source} />}
        {item.source && seriousNotices(item.source).map((n) => <NoticeTag key={n.url} type={n.type} />)}
        {item.replication_outcome && (
          <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
            {REPLICATION_OUTCOMES[item.replication_outcome]}
          </span>
        )}
        {item.status === "retracted" ? (
          <span className="rounded-full bg-red-700 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">RETRACTED</span>
        ) : (
          <Badges badges={item.scrutiny.badges} />
        )}
        {item.collections.map((c) => <CollectionChip key={c.slug} c={c} />)}
        <span className="ml-auto font-mono text-[11px] text-muted">{item.id}</span>
      </div>
      <h3 className="font-serif text-lg font-semibold leading-snug">
        <Link href={`/c/${item.id}`} className="hover:text-accent">{item.title}</Link>
      </h3>
      <p className="mt-1 text-sm text-muted">
        {item.authors.slice(0, 12).join(", ")}
        {item.authors.length > 12 && " et al."} ·{" "}
        {item.source ? `${item.source.venue}${item.source.published ? `, ${item.source.published.slice(0, 4)}` : ""}` : timeAgo(item.updated_at)}
      </p>
      {item.abstract && <p className="mt-2 line-clamp-3 text-sm leading-6">{item.abstract}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ScrutinyLine s={item.scrutiny} />
        <span className="ml-auto"><LicenseTag license={item.license} source={item.source} /></span>
      </div>
    </article>
  );
}
