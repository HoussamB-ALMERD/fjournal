import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { feed, getUserByHandle, reputationOf, reviewsBy } from "@/lib/queries";
import { reputationBreakdown } from "@/lib/reputation";
import { RECOMMENDATIONS } from "@/lib/constants";
import { FeedCard } from "@/components/FeedCard";
import { OrcidBadge, fmtDate, timeAgo } from "@/components/ui";
import { all } from "@/lib/db";
import { ROLES, boardServiceOf } from "@/lib/collections";

const REP_LABEL: Record<string, string> = {
  contribution: "Contributions published",
  negative_result: "Negative results published",
  replication_published: "Replications performed",
  replicated_by_others: "Work independently reproduced",
  review_helpful: "Helpful votes on reviews",
  endorsement_received: "Endorsements received",
  moderation_reversal: "Reversed by moderation",
  moderation_restored: "Restored on appeal",
};

export async function generateMetadata({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  const u = await getUserByHandle(handle);
  return { title: u ? `${u.display_name} (@${u.handle})` : "Not found" };
}

export default async function ProfilePage({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  const u = await getUserByHandle(handle);
  if (!u) notFound();
  const me = await currentUser();
  const rep = await reputationOf(u.id);
  const breakdown = await reputationBreakdown(u.id);
  const works = await feed({ owner: u.id, limit: 100 });
  const reviews = await reviewsBy(u.id);
  const helpful = reviews.reduce((s, r) => s + r.helpful, 0);
  const withDoi = reviews.filter((r) => r.doi_status === "registered").length;
  const service = await boardServiceOf(u.id);
  const claimed = await all<{ id: string; title: string; venue: string | null }>(
    `SELECT c.id, v.title, v.source::jsonb ->> 'venue' AS venue
     FROM contribution_authors a JOIN contributions c ON c.id = a.contribution_id
     JOIN versions v ON v.contribution_id = c.id AND v.number = c.latest_version
     WHERE a.user_id = ? AND c.status <> 'hidden' ORDER BY a.created_at DESC`,
    u.id,
  );

  return (
    <div className="grid gap-10 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-5">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-bold">{u.display_name}</h1>
          <p className="text-muted">@{u.handle}</p>
          {u.affiliation && <p className="text-sm">{u.affiliation}</p>}
          {u.orcid && u.orcid_verified_at ? (
            <OrcidBadge orcid={u.orcid} />
          ) : (
            u.orcid && (
              <a href={`https://orcid.org/${u.orcid}`} className="block font-mono text-xs text-muted underline" target="_blank" rel="noreferrer">
                ORCID {u.orcid} (self-reported, unverified)
              </a>
            )
          )}
          {u.bio && <p className="whitespace-pre-line text-sm leading-6">{u.bio}</p>}
          <p className="text-xs text-muted">Member since {fmtDate(u.created_at)}</p>
          {me?.id === u.id && <Link href="/settings" className="btn-ghost">Edit profile</Link>}
        </div>

        <div className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Reputation</h2>
            <span className="font-serif text-3xl font-semibold">{Math.round(rep)}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Earned only through contributions, helpful reviews and replications.</p>
          {breakdown.length > 0 && (
            <dl className="mt-4 space-y-1 text-sm">
              {breakdown.map((b) => (
                <div key={b.kind} className="flex justify-between gap-2">
                  <dt className="text-muted">{REP_LABEL[b.kind] ?? b.kind} ({b.n})</dt>
                  <dd className="font-mono">{b.points >= 0 ? "+" : ""}{b.points}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {service.length > 0 && (
          <div className="card p-5 text-sm">
            <h2 className="mb-2 font-semibold">Editorial boards</h2>
            <ul className="space-y-2">
              {service.map((s) => (
                <li key={s.slug}>
                  <Link href={`/j/${s.slug}`} className="font-medium hover:text-accent">{s.name}</Link>
                  <p className="text-xs text-muted">
                    {ROLES[s.role].label}{s.status === "left" ? " (former)" : ""} · since {s.since.slice(0, 10)} · {s.decisions} public decision{s.decisions === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card p-5 text-sm">
          <h2 className="mb-2 font-semibold">Scrutiny report</h2>
          <ul className="space-y-1 text-muted">
            <li>{works.length} contributions</li>
            <li>{works.filter((w) => w.type === "replication").length} replications performed</li>
            <li>{works.filter((w) => w.type === "negative_result").length} negative results shared</li>
            <li>{reviews.length} public reviews written ({helpful} helpful votes)</li>
            <li>{withDoi} reviews with a DOI · {reviews.filter((r) => r.imported).length} of work published elsewhere</li>
            {claimed.length > 0 && <li>{claimed.length} imported works verified as their author</li>}
            <li>{works.filter((w) => w.scrutiny.badges.some((b) => b.key === "open")).length} fully open (data + code)</li>
            <li>{works.filter((w) => w.scrutiny.badges.some((b) => b.key === "replicated")).length} independently replicated</li>
          </ul>
          <p className="mt-3 text-xs text-muted">A transparent record for hiring and funding committees — evidence, not venue names.</p>
          <Link href={`/u/${u.handle}/report`} className="btn-ghost mt-3 w-full">One-page report for committees</Link>
        </div>
      </aside>

      <div className="min-w-0 space-y-10">
        <section className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">Contributions</h2>
          {works.length === 0 ? <p className="text-sm text-muted">Nothing published yet.</p> : works.map((w) => <FeedCard key={w.id} item={w} />)}
        </section>
        {claimed.length > 0 && (
          <section className="space-y-3">
            <h2 className="font-serif text-xl font-semibold">Verified authorship of work published elsewhere</h2>
            <ul className="card divide-y divide-line">
              {claimed.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <Link href={`/c/${w.id}`} className="min-w-0 truncate hover:text-accent">{w.title}</Link>
                  <span className="ml-auto shrink-0 text-xs text-muted">{w.venue} · verified via ORCID</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="font-serif text-xl font-semibold">Peer reviews</h2>
            {reviews.length > 0 && (
              <span className="ml-auto flex gap-3 text-xs">
                Export for your CV:
                <a href={`/u/${u.handle}/reviews?format=bibtex`} className="text-accent underline">BibTeX</a>
                <a href={`/u/${u.handle}/reviews?format=ris`} className="text-accent underline">RIS</a>
                <a href={`/u/${u.handle}/reviews?format=csl`} className="text-accent underline">CSL-JSON</a>
              </span>
            )}
          </div>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted">No reviews yet.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {reviews.map((r) => (
                <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <Link href={`/r/${r.id}`} className="min-w-0 truncate hover:text-accent">Review of &ldquo;{r.title}&rdquo;</Link>
                    <span className="ml-auto shrink-0 text-xs text-muted">{r.helpful} helpful · {timeAgo(r.created_at)}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted">
                    <span>v{r.version_number} · {RECOMMENDATIONS[r.recommendation]}</span>
                    {r.imported ? <span>published elsewhere</span> : null}
                    {r.doi_status === "registered" && r.doi && (
                      <a href={`https://doi.org/${r.doi}`} className="font-mono text-accent underline">doi:{r.doi}</a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
