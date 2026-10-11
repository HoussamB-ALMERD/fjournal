import Link from "next/link";
import type { FeedItem } from "@/lib/queries";
import { REPLICATION_OUTCOMES } from "@/lib/constants";
import { Badges, CollectionChip, LicenseTag, NoticeTag, ScrutinyLine, TypeTag, seriousNotices, timeAgo } from "./ui";

/** One entry in a table of contents: ruled, not boxed. The parent list draws the dividers. */
export function FeedCard({ item }: { item: FeedItem }) {
  const retracted = item.status === "retracted";
  const notices = item.source ? seriousNotices(item.source) : [];
  const shown = item.authors.slice(0, 8);
  return (
    <article className="group py-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <TypeTag type={item.type} />
        {item.replication_outcome && (
          <span className="text-xs font-medium text-ink">{REPLICATION_OUTCOMES[item.replication_outcome]}</span>
        )}
        {retracted && <span className="kicker text-red-700 dark:text-red-400">Retracted</span>}
        {notices.map((n) => <NoticeTag key={n.url} type={n.type} />)}
        <span className="ml-auto font-mono text-[11px] text-faint">{item.id}</span>
      </div>

      <h3 className="mt-2 max-w-3xl font-serif text-[1.3rem] font-semibold leading-snug tracking-[-0.01em] text-pretty">
        <Link href={`/c/${item.id}`} className="decoration-1 underline-offset-4 group-hover:underline">
          {item.title}
        </Link>
      </h3>

      <p className="mt-1.5 text-sm text-muted">
        {shown.join(", ")}
        {item.authors.length > shown.length && " et al."}
        <span className="text-faint"> · </span>
        {item.source ? (
          <>
            <span className="italic">{item.source.venue}</span>
            {item.source.published && `, ${item.source.published.slice(0, 4)}`}
            <span className="text-faint"> · </span>opened for review here
          </>
        ) : (
          timeAgo(item.updated_at)
        )}
      </p>

      {item.abstract && <p className="mt-2.5 line-clamp-2 max-w-3xl text-[0.9375rem] leading-relaxed text-ink/80">{item.abstract}</p>}

      {(!retracted && item.scrutiny.badges.length > 0) || item.collections.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {!retracted && <Badges badges={item.scrutiny.badges} />}
          {item.collections.map((c) => <CollectionChip key={c.slug} c={c} />)}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <ScrutinyLine s={item.scrutiny} />
        <span className="text-faint" aria-hidden>·</span>
        <LicenseTag license={item.license} source={item.source} />
      </div>
    </article>
  );
}
