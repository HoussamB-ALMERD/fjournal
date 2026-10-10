import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isAuthorOf } from "@/lib/authors";
import { ROLES, boardOf, getCollection, itemsOf, roleOf } from "@/lib/collections";
import { CollectionHeader } from "@/components/CollectionHeader";
import {
  CollectionForm,
  DecisionForm,
  DeselectForm,
  InvitationResponseForm,
  InviteForm,
  LeaveBoardForm,
  MemberForm,
  NominateForm,
  WithdrawForm,
} from "@/components/CollectionForms";
import { OrcidBadge, UserLink, timeAgo } from "@/components/ui";

export async function generateMetadata({ params }: PageProps<"/j/[slug]/desk">): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCollection(slug);
  return c ? { title: `Editorial desk · ${c.name}` } : {};
}

export default async function DeskPage({ params, searchParams }: PageProps<"/j/[slug]/desk">) {
  const { slug } = await params;
  const { founded } = await searchParams;
  const c = await getCollection(slug);
  if (!c) notFound();
  const me = await currentUser();
  if (!me) redirect(`/login?next=/j/${slug}/desk`);
  const role = await roleOf(c.id, me.id);
  const board = await boardOf(c.id);
  const invitedMembers = await boardOf(c.id, ["invited"]);
  const header = <CollectionHeader c={c} tab="desk" isBoard={!!role} board={board.length} verified={board.filter((m) => m.orcid).length} />;

  if (!role) {
    const invited = invitedMembers.some((m) => m.user_id === me.id);
    return (
      <div className="space-y-8">
        {header}
        <div className="card mx-auto max-w-xl space-y-3 p-6 text-sm">
          {invited ? (
            <>
              <p>You&apos;ve been invited to this board. Your membership, role and decisions will be public.</p>
              <InvitationResponseForm collectionId={c.id} />
            </>
          ) : (
            <p>
              The editorial desk is for this collection&apos;s board. Everything decided here is public in the{" "}
              <Link href={`/j/${slug}/log`} className="text-accent underline">log</Link>.
            </p>
          )}
        </div>
      </div>
    );
  }

  const managing = role === "managing";
  const pending = await itemsOf(c.id, ["submitted"]);
  // Works the viewer wrote can't be decided by them; known before rendering.
  const ownWork = new Set(
    (await Promise.all(pending.map(async (i) => ((await isAuthorOf(me.id, i.contribution_id)) ? i.contribution_id : null)))).filter(Boolean),
  );
  const selected = await itemsOf(c.id, ["selected"]);

  return (
    <div className="space-y-8">
      {header}
      {founded && (
        <div className="card space-y-1 border-emerald-600/40 p-4 text-sm">
          <p className="font-semibold">Your collection is live.</p>
          <p className="text-muted">
            Next: invite the rest of your board below, then nominate work or tell your authors where to submit. Ask board
            members to connect ORCID in their settings, so readers can see who they are.
          </p>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-10">
          <section className="space-y-4">
            <h2 className="font-serif text-2xl font-semibold">Awaiting a decision ({pending.length})</h2>
            {pending.length === 0 && <p className="text-sm text-muted">Nothing waiting. Nominate work, or point authors to the collection.</p>}
            {pending.map((i) => {
              const own = ownWork.has(i.contribution_id);
              return (
                <article key={i.contribution_id} className="card space-y-3 p-5">
                  <div className="space-y-1">
                    <Link href={`/c/${i.contribution_id}`} className="font-serif text-lg font-semibold hover:text-accent">{i.title}</Link>
                    <p className="text-xs text-muted">
                      {JSON.parse(i.authors).slice(0, 8).join(", ")} · {i.nominated ? "nominated" : "submitted"} by @{i.submitted_by_handle}{" "}
                      {timeAgo(i.created_at)} · submitted as v{i.version_number}
                      {i.latest_version > i.version_number && `, now at v${i.latest_version}`} ·{" "}
                      <Link href={`/c/${i.contribution_id}#reviews`} className="underline">{i.review_count} public review{i.review_count === 1 ? "" : "s"}</Link>
                    </p>
                    {i.note && <p className="rounded-md bg-paper p-2 text-sm">&ldquo;{i.note}&rdquo;</p>}
                  </div>
                  {own ? (
                    <p className="text-sm text-muted">You&apos;re an author of this work, so another editor has to decide.</p>
                  ) : (
                    <DecisionForm
                      collectionId={c.id}
                      contributionId={i.contribution_id}
                      nominated={!!i.nominated}
                      reviewCount={i.review_count}
                      minReviews={c.min_reviews}
                    />
                  )}
                  {!!i.nominated && <WithdrawForm collectionId={c.id} contributionId={i.contribution_id} label="Drop this nomination" />}
                </article>
              );
            })}
          </section>

          <section className="space-y-3">
            <h2 className="font-serif text-xl font-semibold">Nominate a work</h2>
            <p className="text-sm text-muted">
              Any work published here, or any paper from arXiv, bioRxiv or with a DOI. Its authors don&apos;t need to be members.
              Nominations are selected or dropped, never publicly declined, because the authors never asked.
            </p>
            <NominateForm collectionId={c.id} />
          </section>

          {selected.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-serif text-xl font-semibold">Selected ({selected.length})</h2>
              <ul className="card divide-y divide-line">
                {selected.map((i) => (
                  <li key={i.contribution_id} className="space-y-1 px-4 py-3 text-sm">
                    <Link href={`/c/${i.contribution_id}`} className="hover:text-accent">{i.title}</Link>
                    <p className="text-xs text-muted">
                      v{i.version_number} by @{i.decided_by_handle} {i.decided_at && timeAgo(i.decided_at)}
                      {i.work_status === "retracted" && <strong className="ml-2 text-red-700">RETRACTED since selection</strong>}
                    </p>
                    <DeselectForm collectionId={c.id} contributionId={i.contribution_id} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {managing && (
            <section className="space-y-3">
              <h2 className="font-serif text-xl font-semibold">Published settings</h2>
              <CollectionForm collection={c} />
            </section>
          )}
        </div>

        <aside className="space-y-5">
          <div className="card space-y-4 p-5">
            <h2 className="text-sm font-semibold">Board ({board.length})</h2>
            <p className="text-xs text-muted">You are {ROLES[role].label.toLowerCase()}. {ROLES[role].hint}</p>
            <ul className="space-y-4 text-sm">
              {board.map((m) => (
                <li key={m.user_id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <UserLink handle={m.handle} name={m.display_name} />
                    <span className="text-xs text-muted">{ROLES[m.role].label}</span>
                  </div>
                  {m.orcid ? <OrcidBadge orcid={m.orcid} /> : <p className="text-xs text-muted">ORCID not verified</p>}
                  {managing && m.user_id !== me.id && <MemberForm collectionId={c.id} userId={m.user_id} role={m.role} invited={false} />}
                </li>
              ))}
            </ul>
            {invitedMembers.length > 0 && (
              <div className="space-y-3 border-t border-line pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Invited</h3>
                {invitedMembers.map((m) => (
                  <div key={m.user_id} className="space-y-1 text-sm">
                    <span><UserLink handle={m.handle} name={m.display_name} /> <span className="text-xs text-muted">as {ROLES[m.role].label.toLowerCase()}</span></span>
                    {managing && <MemberForm collectionId={c.id} userId={m.user_id} role={m.role} invited />}
                  </div>
                ))}
              </div>
            )}
            {managing && (
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Invite</h3>
                <InviteForm collectionId={c.id} />
              </div>
            )}
            <div className="border-t border-line pt-3">
              <LeaveBoardForm collectionId={c.id} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
