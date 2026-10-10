import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  getContribution,
  getVersion,
  listComments,
  listEndorsements,
  listReplications,
  listReviews,
  listVersions,
  scrutinyFor,
  votedReviewIds,
} from "@/lib/queries";
import { MODERATION_REASONS, RECOMMENDATIONS, REPLICATION_OUTCOMES, RUBRIC } from "@/lib/constants";
import { actionsForContribution, isModerator } from "@/lib/moderation";
import { checksFor, worst } from "@/lib/integrity/run";
import { IntegrityPanel, StatusIcon } from "@/components/IntegrityPanel";
import { voteHelpful } from "@/app/actions";
import { Markdown } from "@/components/Markdown";
import {
  Badges,
  CollectionChip,
  LicenseTag,
  NoticeTag,
  OrcidBadge,
  SourceTag,
  Stars,
  TypeTag,
  UserLink,
  fmtDate,
  seriousNotices,
  timeAgo,
  venueName,
} from "@/components/ui";
import { ClaimAuthorshipForm, CommentForm, EndorseForm, RefreshSourceForm, ReportForm, ReviewForm } from "@/components/forms";
import { BADGE_RULES } from "@/lib/scrutiny";
import { isAuthorOf, verifiedAuthors } from "@/lib/authors";
import { codeTarget, reproEnabled, runsForVersion } from "@/lib/repro/runs";
import { ReproductionPanel } from "@/components/ReproductionPanel";
import { ITEM_STATUS, collectionsForWork, openForSubmission, roleOf } from "@/lib/collections";
import { SubmitToCollectionForm, WithdrawForm } from "@/components/CollectionForms";

export async function generateMetadata({ params }: PageProps<"/c/[id]">): Promise<Metadata> {
  const { id } = await params;
  const c = getContribution(id);
  const v = c && getVersion(id, c.latest_version);
  if (!v || c.status === "hidden") return {};
  // Highwire tags for indexers — only for work published here; imported works are indexed at their source.
  const other = v.source
    ? undefined
    : {
        citation_title: v.title,
        citation_author: v.authors,
        citation_publication_date: v.created_at.slice(0, 10).replace(/-/g, "/"),
        citation_publisher: "Fjournal",
      };
  return { title: v.title, description: v.abstract.slice(0, 300), other };
}

export default async function ContributionPage({ params, searchParams }: PageProps<"/c/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const c = getContribution(id);
  if (!c) notFound();
  const modActions = actionsForContribution(id);
  const latestOn = (targetId: string) => modActions.filter((a) => a.target_id === targetId && a.action !== "restore").at(-1);

  if (c.status === "hidden") {
    const a = latestOn(id);
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-10 text-center">
        <p className="font-mono text-xs text-muted">fj:{c.id}</p>
        <h1 className="font-serif text-3xl font-bold">Removed by moderation</h1>
        <p className="text-muted">
          This contribution was removed for <strong>{a ? MODERATION_REASONS[a.reason].label.toLowerCase() : "a policy violation"}</strong>.
          Its ledger entries remain, so the record that it existed can&apos;t be erased. The decision, the reasoning and any
          appeal are public.
        </p>
        {a && <Link href={`/moderation/${a.seq}`} className="btn">Read moderation log entry #{a.seq}</Link>}
      </div>
    );
  }

  const requested = Number(sp.v);
  const vNum = Number.isInteger(requested) && requested >= 1 && requested <= c.latest_version ? requested : c.latest_version;
  const v = getVersion(id, vNum)!;
  const isLatest = vNum === c.latest_version;
  const me = await currentUser();
  const isOwner = me?.id === c.owner_id;
  // Owners and members who proved authorship through ORCID: they answer reviews, they don't write them.
  const isAuthor = !!me && isAuthorOf(me.id, id);
  const claimedAuthors = verifiedAuthors(id);
  const authorHandles = new Set([c.owner_handle, ...claimedAuthors.map((a) => a.handle)].filter(Boolean));
  const retraction = c.status === "retracted" ? latestOn(id) : undefined;
  const checks = checksFor(v.seq);

  const versions = listVersions(id);
  const reviews = listReviews(id);
  const replications = listReplications(id);
  const endorsements = listEndorsements(id);
  const comments = listComments(id);
  const s = scrutinyFor(id, getVersion(id, c.latest_version)!.artifacts, c.latest_version);
  const voted = me ? votedReviewIds(me.id, id) : new Set<string>();
  const target = c.replication_of ? getContribution(c.replication_of) : undefined;
  const targetTitle = target ? getVersion(target.id, target.latest_version)?.title : undefined;
  const year = new Date(v.created_at).getUTCFullYear();
  const src = v.source; // set only on works published elsewhere and imported for review
  const serious = src ? seriousNotices(src) : [];
  // Withdrawn entries live only in the collection's log; everything else is shown here.
  const inCollections = collectionsForWork(id).filter((x) => x.status !== "withdrawn");
  const submittable = isAuthor && c.status === "active" ? openForSubmission(id) : [];

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_300px]">
      <article className="min-w-0 space-y-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <TypeTag type={c.type} />
            {src && <SourceTag source={src} />}
            {serious.map((n) => <NoticeTag key={n.url} type={n.type} />)}
            {c.status === "retracted" ? (
              <span className="rounded-full bg-red-700 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">RETRACTED</span>
            ) : (
              <Badges badges={s.badges} />
            )}
            {inCollections.filter((x) => x.status === "selected").map((x) => <CollectionChip key={x.slug} c={x} />)}
            <span className="ml-auto font-mono text-xs text-muted">fj:{c.id} · v{vNum}</span>
          </div>
          {retraction && (
            <div className="rounded-md border-2 border-red-700/60 bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
              <p className="font-semibold">
                Retracted for {MODERATION_REASONS[retraction.reason].label.toLowerCase()} on {fmtDate(retraction.created_at)}.
              </p>
              <p className="mt-1">{retraction.explanation}</p>
              <p className="mt-2 text-xs">
                The work stays readable so the scientific record is complete.{" "}
                <Link href={`/moderation/${retraction.seq}`} className="font-semibold underline">Moderation log #{retraction.seq}</Link>
                {retraction.evidence_url && (
                  <> · <a href={retraction.evidence_url} className="underline" target="_blank" rel="noreferrer nofollow">Evidence</a></>
                )}
              </p>
            </div>
          )}
          {serious.length > 0 && (
            <div className="rounded-md border-2 border-red-700/60 bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
              {serious.map((n) => (
                <p key={n.url}>
                  The publisher has registered a <strong>{n.type.replace(/[_-]/g, " ")}</strong> for this work
                  {n.date && <> ({n.date})</>}. <a href={n.url} className="font-semibold underline" target="_blank" rel="noreferrer">Read the notice</a>
                </p>
              ))}
              <p className="mt-2 text-xs">Reported through Crossref, which includes Retraction Watch data. Fjournal keeps the record and its reviews.</p>
            </div>
          )}
          {!isLatest && (
            <p className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              You are reading version {vNum} of {c.latest_version}.{" "}
              <Link href={`/c/${id}`} className="font-semibold underline">Read the latest version</Link>
            </p>
          )}
          <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight">{v.title}</h1>
          <p className="text-muted">{v.authors.join(", ")}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            {c.owner_handle ? (
              <span>Submitted by <UserLink handle={c.owner_handle} /></span>
            ) : (
              c.importer_handle && <span>Opened for review by <UserLink handle={c.importer_handle} /></span>
            )}
            <span>Version {vNum} · {fmtDate(v.created_at)}</span>
            <LicenseTag license={v.license} source={src} />
            <span>© the authors</span>
          </div>
          {src && (
            <div className="card space-y-3 border-amber-600/40 p-4 text-sm">
              <p>
                <strong>Published elsewhere.</strong> This is the open review record of a work published in{" "}
                <strong>{src.venue || venueName(src)}</strong>
                {src.published && <> ({src.published})</>}. The authors keep every right to it. Fjournal hosts the
                public review, not the paper.
              </p>
              <div className="flex flex-wrap gap-2">
                <a href={src.url} className="btn" target="_blank" rel="noreferrer">
                  Read it at {venueName(src)}
                  {src.version && ` (v${src.version})`}
                </a>
                {src.links.map((l) => (
                  <a key={l.url} href={l.url} className="btn-ghost" target="_blank" rel="noreferrer">{l.label}</a>
                ))}
              </div>
              {src.notices.length > serious.length && (
                <p className="text-xs">
                  Updates registered by the publisher:{" "}
                  {src.notices
                    .filter((n) => !serious.includes(n))
                    .map((n, i) => (
                      <span key={n.url}>
                        {i > 0 && ", "}
                        <a href={n.url} className="underline" target="_blank" rel="noreferrer">{n.type.replace(/[_-]/g, " ")}</a>
                        {n.date && ` (${n.date})`}
                      </span>
                    ))}
                </p>
              )}
              {claimedAuthors.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">Verified authors on Fjournal:</span>
                  {claimedAuthors.map((a) => (
                    <span key={a.user_id} className="flex items-center gap-1">
                      <UserLink handle={a.handle} name={a.display_name} />
                      <OrcidBadge orcid={a.orcid} />
                    </span>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted">
                Metadata retrieved from {venueName(src)} on {fmtDate(src.retrieved_at)} and hashed into the ledger. Are you
                an author? Claim it by connecting the ORCID record that lists it, then answer reviewers in the discussion.
              </p>
            </div>
          )}
          {target && (
            <div className="card border-violet-500/40 p-3 text-sm">
              <strong>Replication</strong> of{" "}
              <Link href={`/c/${target.id}`} className="text-accent underline">{targetTitle}</Link> —{" "}
              outcome: <strong>{c.replication_outcome ? REPLICATION_OUTCOMES[c.replication_outcome] : "unknown"}</strong>
            </div>
          )}
          {vNum > 1 && v.change_note && (
            <div className="rounded-md bg-accent-soft p-3 text-sm">
              <strong>What changed in v{vNum}:</strong> {v.change_note}
            </div>
          )}
        </header>

        {replications.length > 0 && (
          <section className="card divide-y divide-line">
            <h2 className="px-4 py-3 text-sm font-semibold">Independent replications ({replications.length})</h2>
            {replications.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    r.replication_outcome === "reproduced"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : r.replication_outcome === "failed"
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  }`}
                >
                  {r.replication_outcome ? REPLICATION_OUTCOMES[r.replication_outcome] : "—"}
                </span>
                <Link href={`/c/${r.id}`} className="min-w-0 truncate hover:text-accent">{r.title}</Link>
                <span className="ml-auto shrink-0 text-xs text-muted">@{r.owner_handle}</span>
              </div>
            ))}
          </section>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Abstract</h2>
          {v.abstract ? (
            <p className="font-serif text-[17px] leading-8">{v.abstract}</p>
          ) : (
            <p className="text-sm text-muted">The source provides no abstract. Read the work at the source.</p>
          )}
        </section>

        {v.body && (
          <section className="border-t border-line pt-6">
            <Markdown>{v.body}</Markdown>
          </section>
        )}

        <section className="border-t border-line pt-6">
          <h2 className="mb-3 font-serif text-xl font-semibold">Data, code & materials</h2>
          {v.artifacts.length === 0 && src ? (
            <p className="text-sm text-muted">
              Any data and code are listed at the source. If you find them, link them in the discussion so reviewers and
              replicators can use them.
            </p>
          ) : v.artifacts.length === 0 ? (
            <p className="text-sm text-muted">No artifacts attached to this version.</p>
          ) : (
            <ul className="space-y-2">
              {v.artifacts.map((a, i) => (
                <li key={i} className="card flex flex-wrap items-center gap-3 p-3 text-sm">
                  <span className="rounded bg-line/60 px-1.5 py-0.5 font-mono text-[11px] uppercase">{a.kind}</span>
                  <a href={a.url} target="_blank" rel="noreferrer nofollow" className="min-w-0 truncate text-accent underline">
                    {a.label || a.url}
                  </a>
                  {a.pin && <span className="ml-auto font-mono text-xs text-muted">pinned: {a.pin}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-t border-line pt-6" id="declarations">
          <h2 className="mb-3 font-serif text-xl font-semibold">Funding & competing interests</h2>
          {src ? (
            <p className="text-sm text-muted">
              Made to the original venue. See the funding and competing-interest statements in the publication itself.
            </p>
          ) : v.declarations ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-[160px_1fr]">
              <dt className="text-muted">Funding</dt>
              <dd>
                {v.declarations.funding.length === 0 ? (
                  "No specific funding declared."
                ) : (
                  <ul className="space-y-1">
                    {v.declarations.funding.map((f, i) => (
                      <li key={i}>
                        {f.funder}
                        {f.grant && <span className="ml-2 font-mono text-xs text-muted">{f.grant}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt className="text-muted">Competing interests</dt>
              <dd className={v.declarations.competing_interests ? "rounded-md bg-amber-50 p-2 dark:bg-amber-950" : ""}>
                {v.declarations.competing_interests || "The authors declare no competing interests."}
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted">Not declared. This version was published before declarations were required.</p>
          )}
        </section>

        <IntegrityPanel checks={checks} contributionId={id} versionNumber={vNum} canRerun={isOwner || isModerator(me) || (!!me && me.id === c.imported_by)} />

        {!src && (
          <ReproductionPanel
            runs={runsForVersion(v.seq)}
            hasCode={!!codeTarget(v.artifacts)}
            enabled={reproEnabled()}
            canRequest={!!me}
            contributionId={id}
            versionNumber={vNum}
          />
        )}

        <section className="space-y-4 border-t border-line pt-6" id="reviews">
          <h2 className="font-serif text-xl font-semibold">Public reviews ({reviews.length})</h2>
          {reviews.length === 0 && (
            <p className="text-sm text-muted">No reviews yet. Anyone can review — be the first to engage with this work.</p>
          )}
          {reviews.map((r) =>
            r.hidden ? (
              <div key={r.id} id={r.id} className="card p-4 text-sm text-muted">
                A review by @{r.reviewer_handle} was removed for{" "}
                {MODERATION_REASONS[latestOn(r.id)?.reason ?? "harassment"].label.toLowerCase()}.{" "}
                {latestOn(r.id) && <Link href={`/moderation/${latestOn(r.id)!.seq}`} className="underline">Log #{latestOn(r.id)!.seq}</Link>}
              </div>
            ) : (
            <div key={r.id} id={r.id} className="card space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <UserLink handle={r.reviewer_handle} name={r.reviewer_name} />
                <span className="text-xs text-muted">on v{r.version_number}{r.version_number !== c.latest_version && " (earlier version)"} · {timeAgo(r.created_at)}</span>
                {r.reviewer_orcid && <OrcidBadge orcid={r.reviewer_orcid} />}
                <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-xs font-semibold">
                  {RECOMMENDATIONS[r.recommendation]}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                {RUBRIC.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="capitalize text-muted">{k}</span>
                    <Stars value={r[k]} />
                  </div>
                ))}
              </div>
              <Markdown>{r.body}</Markdown>
              <p className="text-xs text-muted">
                Reviewer&apos;s competing interests:{" "}
                {r.competing_interests === null ? "not asked (earlier review)" : r.competing_interests || "none declared"}
              </p>
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs text-muted">
                <span>{r.helpful} found this helpful</span>
                <Link href={`/r/${r.id}`} className="underline">Permalink & cite</Link>
                {r.doi_status === "registered" && r.doi && (
                  <a href={`https://doi.org/${r.doi}`} className="font-mono text-accent underline">doi:{r.doi}</a>
                )}
                {me && me.id !== r.reviewer_id && !isAuthor && (
                  voted.has(r.id) ? (
                    <span className="text-accent">✓ You marked this helpful</span>
                  ) : (
                    <form action={voteHelpful}>
                      <input type="hidden" name="review_id" value={r.id} />
                      <button className="btn-ghost px-2 py-0.5 text-xs">Helpful</button>
                    </form>
                  )
                )}
                {me && me.id !== r.reviewer_id && <span className="ml-auto"><ReportForm targetType="review" targetId={r.id} /></span>}
              </div>
            </div>
            ),
          )}

          <div className="card p-5">
            <h3 className="mb-1 font-semibold">Review version {c.latest_version}</h3>
            {!me ? (
              <p className="text-sm text-muted">
                <Link href={`/login?next=/c/${id}`} className="text-accent underline">Sign in</Link> to review. No credentials
                required — the quality of your review is what counts.
              </p>
            ) : isAuthor ? (
              <p className="text-sm text-muted">
                You can&apos;t review your own work. Respond to reviewers in the discussion{isOwner ? " or post a new version" : ""}.
              </p>
            ) : (
              <>
                <p className="mb-4 text-sm text-muted">
                  Engage with the science. Reviews that others find helpful earn you reputation; a verdict without reasoning earns nothing.
                </p>
                <ReviewForm contributionId={id} versionNumber={c.latest_version} />
              </>
            )}
          </div>
        </section>

        <section className="space-y-4 border-t border-line pt-6" id="discussion">
          <h2 className="font-serif text-xl font-semibold">Discussion ({comments.length})</h2>
          {comments.map((m) =>
            m.hidden ? (
              <p key={m.id} className="text-xs text-muted">
                A comment was removed by moderation.{" "}
                {latestOn(m.id) && <Link href={`/moderation/${latestOn(m.id)!.seq}`} className="underline">Log #{latestOn(m.id)!.seq}</Link>}
              </p>
            ) : (
              <div key={m.id} className="space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <UserLink handle={m.handle} name={m.display_name} />
                  {authorHandles.has(m.handle) && (
                    <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold uppercase text-accent">Author</span>
                  )}
                  · v{m.version_number} · {timeAgo(m.created_at)}
                  {me && me.handle !== m.handle && <span className="ml-auto"><ReportForm targetType="comment" targetId={m.id} /></span>}
                </div>
                <div className="text-sm"><Markdown>{m.body}</Markdown></div>
              </div>
            ),
          )}
          {me ? (
            <CommentForm contributionId={id} versionNumber={vNum} />
          ) : (
            <p className="text-sm text-muted">
              <Link href={`/login?next=/c/${id}`} className="text-accent underline">Sign in</Link> to join the discussion.
            </p>
          )}
        </section>
      </article>

      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <div className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">Scrutiny record</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Reviews</dt>
            <dd className="text-right">{s.reviewCount} ({s.distinctReviewers} people)</dd>
            <dt className="text-muted">Soundness</dt>
            <dd className="text-right">{s.soundness !== null ? `${s.soundness.toFixed(2)} / 5` : "—"}</dd>
            <dt className="text-muted">Reproducibility</dt>
            <dd className="text-right">{s.reproducibility !== null ? `${s.reproducibility.toFixed(2)} / 5` : "—"}</dd>
            <dt className="text-muted">Replications</dt>
            <dd className="text-right">
              <span className="text-emerald-700 dark:text-emerald-400">{s.reproduced}✓</span>{" "}
              <span className="text-amber-700 dark:text-amber-400">{s.partial}~</span>{" "}
              <span className="text-red-700 dark:text-red-400">{s.failed}✗</span>
            </dd>
            <dt className="text-muted">Endorsements</dt>
            <dd className="text-right">{s.endorsements}</dd>
            <dt className="text-muted">Data / code</dt>
            <dd className="text-right">{s.hasData ? "✓" : "✗"} / {s.hasCode ? "✓" : "✗"}</dd>
            <dt className="text-muted">Versions</dt>
            <dd className="text-right">{s.versions}</dd>
            <dt className="text-muted">Automated checks</dt>
            <dd className="flex justify-end">
              {checks.length ? (
                <a href="#integrity" className="flex items-center gap-1">
                  <StatusIcon status={worst(checks.map((k) => k.status))} />
                </a>
              ) : (
                "running"
              )}
            </dd>
          </dl>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Badge rules</summary>
            <ul className="mt-2 space-y-1">
              {BADGE_RULES.map((b) => (
                <li key={b.key}><strong>{b.label}:</strong> {b.rule}</li>
              ))}
            </ul>
            <p className="mt-2">Scores are weighted by reviewer reputation (logarithmic).</p>
          </details>
        </div>

        <div className="card space-y-2 p-5">
          {isOwner && (
            <Link href={`/c/${id}/edit`} className="btn w-full">Post a new version</Link>
          )}
          {!isAuthor && (
            <Link href={`/submit?replicate=${id}`} className="btn-ghost w-full">Report a replication</Link>
          )}
          {me && src?.version != null && <RefreshSourceForm contributionId={id} />}
          {me && !isAuthor && c.status === "active" && !endorsements.some((e) => e.user_id === me.id) && <EndorseForm contributionId={id} />}
          {me && src && !isAuthor && c.status === "active" &&
            (me.orcid_verified_at ? (
              <ClaimAuthorshipForm contributionId={id} />
            ) : (
              <p className="text-xs text-muted">
                Wrote this? <Link href="/settings#orcid" className="text-accent underline">Connect ORCID</Link> to claim it.
              </p>
            ))}
          {me && !isAuthor && c.status === "active" && (
            <div className="pt-1"><ReportForm targetType="contribution" targetId={id} /></div>
          )}
          {endorsements.length > 0 && (
            <div className="pt-2 text-xs text-muted">
              Endorsed by{" "}
              {endorsements.map((e, i) => (
                <span key={e.user_id} title={e.note || undefined}>
                  {i > 0 && ", "}
                  <UserLink handle={e.handle} />
                </span>
              ))}
            </div>
          )}
        </div>

        {(inCollections.length > 0 || submittable.length > 0) && (
          <div className="card space-y-3 p-5" id="collections">
            <h2 className="text-sm font-semibold">Collections</h2>
            {inCollections.length > 0 && (
              <ul className="space-y-3 text-sm">
                {inCollections.map((x) => (
                  <li key={x.slug} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.accent }} aria-hidden />
                      <Link href={`/j/${x.slug}`} className="min-w-0 truncate font-medium hover:text-accent">{x.name}</Link>
                    </div>
                    <p className="text-xs text-muted">
                      {ITEM_STATUS[x.status]}
                      {x.status !== "submitted" && <> · v{x.version_number}</>}
                      {x.status === "submitted" && x.nominated ? " · nominated by the board" : ""}
                      {x.decided_by_handle && x.status !== "submitted" && <> · by @{x.decided_by_handle}</>} ·{" "}
                      <Link href={`/j/${x.slug}/log#e${x.log_seq}`} className="underline">{x.status === "submitted" ? "log" : "reasoning"}</Link>
                      {x.status === "submitted" && me && roleOf(x.collection_id, me.id) && !isAuthor && (
                        <> · <Link href={`/j/${x.slug}/desk`} className="text-accent underline">decide</Link></>
                      )}
                    </p>
                    {isAuthor && (x.status === "submitted" || x.status === "selected") && (
                      <WithdrawForm collectionId={x.collection_id} contributionId={id} label="Withdraw from this collection" />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {submittable.length > 0 && <SubmitToCollectionForm contributionId={id} options={submittable} />}
          </div>
        )}

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">Version history</h2>
          <ol className="space-y-3">
            {versions.map((ver) => (
              <li key={ver.number} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/c/${id}?v=${ver.number}`} className={ver.number === vNum ? "font-semibold text-accent" : "hover:text-accent"}>
                    v{ver.number}
                  </Link>
                  <span className="text-xs text-muted">{timeAgo(ver.created_at)}</span>
                </div>
                {ver.change_note && <p className="line-clamp-2 text-xs text-muted">{ver.change_note}</p>}
                <p className="hash" title="Ledger chain hash">#{ver.seq} {ver.chain_hash.slice(0, 16)}…</p>
                <a href={`/c/${id}/v/${ver.number}/receipt`} className="text-xs text-accent underline">Priority receipt</a>
              </li>
            ))}
          </ol>
        </div>

        <div className="card space-y-2 p-5">
          <h2 className="text-sm font-semibold">Cite this version</h2>
          {src ? (
            <>
              <p className="select-all rounded bg-paper p-2 font-mono text-[11px] leading-5">
                {v.authors.slice(0, 20).join(", ")}
                {v.authors.length > 20 && " et al."} ({src.published?.slice(0, 4) ?? "n.d."}). {v.title}. {src.venue}
                {src.version && ` v${src.version}`}. {src.kind === "arxiv" ? `arXiv:${src.id}` : `https://doi.org/${src.id}`}
              </p>
              <p className="text-xs text-muted">Open review: Fjournal fj:{c.id} v{vNum}</p>
            </>
          ) : (
            <p className="select-all rounded bg-paper p-2 font-mono text-[11px] leading-5">
              {v.authors.join(", ")} ({year}). {v.title}. Fjournal fj:{c.id} v{vNum}. sha256:{v.content_hash.slice(0, 12)}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
