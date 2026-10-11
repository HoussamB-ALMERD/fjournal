import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { feed } from "@/lib/queries";
import { ROLES, boardOf, getCollection, itemsOf, roleOf } from "@/lib/collections";
import { FeedCard } from "@/components/FeedCard";
import { Markdown } from "@/components/Markdown";
import { CollectionHeader } from "@/components/CollectionHeader";
import { InvitationResponseForm } from "@/components/CollectionForms";
import { OrcidBadge, UserLink, fmtDate, timeAgo } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/j/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCollection(slug);
  return c ? { title: c.name, description: c.tagline || c.scope.slice(0, 300) } : {};
}

export default async function CollectionPage({ params }: PageProps<"/j/[slug]">) {
  const { slug } = await params;
  const c = await getCollection(slug);
  if (!c) notFound();
  const me = await currentUser();
  const role = await roleOf(c.id, me?.id);
  const board = await boardOf(c.id);
  const invited = me ? (await boardOf(c.id, ["invited"])).some((m) => m.user_id === me.id) : false;
  const verified = board.filter((m) => m.orcid).length;

  const selected = await feed({ collection: c.id, limit: 200 });
  const decisions = new Map((await itemsOf(c.id, ["selected"])).map((i) => [i.contribution_id, i]));
  const considering = await itemsOf(c.id, ["submitted"]);
  const declined = (await itemsOf(c.id, ["declined"])).length;

  return (
    <div className="space-y-8">
      <CollectionHeader c={c} tab="home" isBoard={!!role} board={board.length} verified={verified} />

      {invited && (
        <div className="card flex flex-wrap items-center gap-4 border-accent/50 p-4 text-sm">
          <p>You&apos;ve been invited to join this board. Your membership, role and decisions will be public.</p>
          <div className="ml-auto"><InvitationResponseForm collectionId={c.id} /></div>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          <section className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold">Selected works ({selected.length})</h2>
            {selected.length === 0 ? (
              <p className="card p-6 text-sm text-muted">Nothing selected yet. Every decision will appear here and in the public log.</p>
            ) : (
              <div className="divide-y divide-line border-y border-line">
              {selected.map((it) => {
                const d = decisions.get(it.id);
                return (
                  <div key={it.id}>
                    <FeedCard item={it} />
                    {d && (
                      <p className="-mt-3 pb-5 text-xs text-muted">
                        Selected v{d.version_number}
                        {d.version_number < it.latest_version && ` (v${it.latest_version} posted since)`} by{" "}
                        {d.decided_by_handle && <UserLink handle={d.decided_by_handle} name={d.decided_by_name ?? undefined} />}
                        {d.decided_at && <> · {timeAgo(d.decided_at)}</>} ·{" "}
                        <Link href={`/j/${c.slug}/log#e${d.log_seq}`} className="underline">Read the reasoning</Link>
                      </p>
                    )}
                  </div>
                );
              })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-xl font-semibold">Under consideration ({considering.length})</h2>
            {considering.length === 0 ? (
              <p className="text-sm text-muted">Nothing awaiting a decision.</p>
            ) : (
              <ul className="card divide-y divide-line">
                {considering.map((i) => (
                  <li key={i.contribution_id} className="space-y-1 px-4 py-3 text-sm">
                    <Link href={`/c/${i.contribution_id}`} className="font-medium hover:text-accent">{i.title}</Link>
                    <p className="text-xs text-muted">
                      {i.nominated ? "Nominated by an editor" : "Submitted by an author"} · {timeAgo(i.created_at)} ·{" "}
                      <span className={i.review_count >= c.min_reviews ? "" : "text-amber-700 dark:text-amber-400"}>
                        {i.review_count}/{c.min_reviews} public reviews
                      </span>
                      {i.review_count < c.min_reviews && (
                        <>
                          {" "}· <Link href={`/c/${i.contribution_id}#reviews`} className="text-accent underline">Review it</Link>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {declined > 0 && (
              <p className="text-xs text-muted">
                {declined} submission{declined === 1 ? " was" : "s were"} not selected. The reasoning for each is in the{" "}
                <Link href={`/j/${c.slug}/log`} className="underline">public log</Link>.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <div className="card space-y-3 p-5 text-sm">
            <h2 className="font-semibold">Scope</h2>
            <div className="text-sm"><Markdown>{c.scope}</Markdown></div>
          </div>
          <div className="card space-y-3 p-5 text-sm">
            <h2 className="font-semibold">Selection criteria</h2>
            <div className="text-sm"><Markdown>{c.policy}</Markdown></div>
            <p className="border-t border-line pt-3 text-xs text-muted">
              Selection needs at least <strong className="text-ink">{c.min_reviews}</strong> public review{c.min_reviews === 1 ? "" : "s"}.
              Editors can&apos;t decide on their own work, and every decision declares competing interests. Policy last
              changed {fmtDate(c.updated_at)}.
            </p>
          </div>
          <div className="card space-y-2 p-5 text-sm">
            <h2 className="font-semibold">Submitting</h2>
            {c.accepts_submissions ? (
              <p className="text-muted">
                Publish your work on Fjournal (or claim an imported paper with ORCID), then choose &ldquo;Submit to a
                collection&rdquo; on its page. It is published and reviewable from the start, whatever the board decides.
              </p>
            ) : (
              <p className="text-muted">This board doesn&apos;t take submissions. Its editors nominate work from anywhere.</p>
            )}
          </div>
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold">Editorial board ({board.length})</h2>
            <ul className="space-y-3 text-sm">
              {board.map((m) => (
                <li key={m.user_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <UserLink handle={m.handle} name={m.display_name} />
                    <span className="shrink-0 text-xs text-muted">{ROLES[m.role].label}</span>
                  </div>
                  {m.affiliation && <p className="text-xs text-muted">{m.affiliation}</p>}
                  {m.orcid && <OrcidBadge orcid={m.orcid} />}
                </li>
              ))}
            </ul>
          </div>
          <p className="px-1 text-xs text-muted">
            Open data: <a href={`/api/collections/${c.slug}`} className="underline">the whole collection as JSON</a>, including its
            hash-chained log. Founded {fmtDate(c.created_at)}.
          </p>
        </aside>
      </div>
    </div>
  );
}
