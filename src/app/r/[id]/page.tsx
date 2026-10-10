import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { publicUrl } from "@/lib/config";
import { doiConfig } from "@/lib/doi";
import { citationInput, plainCitation } from "@/lib/citation";
import { getContribution, getReview, getVersion } from "@/lib/queries";
import { actionsForContribution } from "@/lib/moderation";
import { LICENSES, MODERATION_REASONS, RECOMMENDATIONS, RUBRIC } from "@/lib/constants";
import { Markdown } from "@/components/Markdown";
import { RequestDoiForm } from "@/components/forms";
import { OrcidBadge, SourceTag, Stars, UserLink, fmtDate } from "@/components/ui";

function load(id: string) {
  const r = getReview(id);
  const c = r && getContribution(r.contribution_id);
  const v = r && c && getVersion(c.id, r.version_number);
  return r && c && v ? { r, c, v } : null;
}

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const d = load((await params).id);
  if (!d || d.r.hidden || d.c.status === "hidden") return {};
  const { r, v } = d;
  // Highwire tags, which Google Scholar and reference managers read.
  return {
    title: `Review of "${v.title}" by ${r.reviewer_name}`,
    description: r.body.slice(0, 300),
    other: {
      citation_title: `Review of "${v.title}" (version ${r.version_number})`,
      citation_author: r.reviewer_name,
      citation_publication_date: r.created_at.slice(0, 10).replace(/-/g, "/"),
      citation_publisher: "Fjournal",
      citation_article_type: "Open peer review",
      ...(r.doi_status === "registered" && r.doi ? { citation_doi: r.doi } : {}),
    },
  };
}

export default async function ReviewPage({ params }: PageProps<"/r/[id]">) {
  const { id } = await params;
  const d = load(id);
  if (!d) notFound();
  const { r, c, v } = d;

  if (r.hidden || c.status === "hidden") {
    const a = actionsForContribution(c.id).filter((x) => x.target_id === (r.hidden ? r.id : c.id) && x.action !== "restore").at(-1);
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-10 text-center">
        <p className="font-mono text-xs text-muted">review {r.id}</p>
        <h1 className="font-serif text-3xl font-bold">Removed by moderation</h1>
        <p className="text-muted">
          {r.hidden ? "This review" : "The work this review discussed"} was removed for{" "}
          <strong>{a ? MODERATION_REASONS[a.reason].label.toLowerCase() : "a policy violation"}</strong>. Its ledger entry
          remains{r.doi ? ", and its DOI resolves to this notice" : ""}.
        </p>
        {a && <Link href={`/moderation/${a.seq}`} className="btn">Moderation log entry #{a.seq}</Link>}
      </div>
    );
  }

  const me = await currentUser();
  const site = await publicUrl();
  const cite = citationInput(r, v.title, site);
  const doiOn = !!doiConfig();
  const isReviewer = me?.id === r.reviewer_id;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-blue-800 dark:bg-blue-950 dark:text-blue-300">
            Open peer review
          </span>
          {v.source && <SourceTag source={v.source} />}
          <span className="ml-auto font-mono text-muted">{r.id}</span>
        </div>
        <h1 className="font-serif text-3xl font-bold leading-tight">
          Review of{" "}
          <Link href={`/c/${c.id}?v=${r.version_number}`} className="hover:text-accent">&ldquo;{v.title}&rdquo;</Link>
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>
            by <UserLink handle={r.reviewer_handle} name={r.reviewer_name} />
          </span>
          {r.reviewer_orcid && <OrcidBadge orcid={r.reviewer_orcid} />}
          <span>{fmtDate(r.created_at)}</span>
          <span>on version {r.version_number}{r.version_number !== c.latest_version && ` of ${c.latest_version}`}</span>
          <span>
            {r.license ? (
              LICENSES[r.license].url ? (
                <a href={LICENSES[r.license].url!} className="underline" target="_blank" rel="noreferrer">{LICENSES[r.license].label}</a>
              ) : (
                LICENSES[r.license].label
              )
            ) : (
              "License not specified (written before reviewers chose one)"
            )}
          </span>
        </div>
      </header>

      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {RUBRIC.map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="capitalize text-muted">{k}</span>
                <Stars value={r[k]} />
              </div>
            ))}
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-sm font-semibold">{RECOMMENDATIONS[r.recommendation]}</span>
        </div>
        <div className="border-t border-line pt-4">
          <Markdown>{r.body}</Markdown>
        </div>
        <p className="text-xs text-muted">
          Reviewer&apos;s competing interests:{" "}
          {r.competing_interests === null ? "not asked (earlier review)" : r.competing_interests || "none declared"} ·{" "}
          {r.helpful} found this helpful ·{" "}
          <Link href={`/c/${c.id}#${r.id}`} className="underline">See it with the other reviews</Link>
        </p>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        <div className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold">Cite this review</h2>
          <p className="select-all rounded bg-paper p-2 font-mono text-[11px] leading-5">{plainCitation(cite)}</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <a href={`/r/${r.id}/cite?format=bibtex`} className="text-accent underline">BibTeX</a>
            <a href={`/r/${r.id}/cite?format=ris`} className="text-accent underline">RIS (Zotero, EndNote, Mendeley)</a>
            <a href={`/r/${r.id}/cite?format=csl`} className="text-accent underline">CSL-JSON</a>
          </div>
        </div>

        <div className="card space-y-3 p-5" id="doi">
          <h2 className="text-sm font-semibold">DOI</h2>
          {r.doi_status === "registered" ? (
            <>
              <a href={`https://doi.org/${r.doi}`} className="block break-all font-mono text-sm text-accent underline">https://doi.org/{r.doi}</a>
              <p className="text-xs text-muted">
                Registered with DataCite as a peer review of this work
                {r.reviewer_orcid ? ", linked to the reviewer's verified ORCID iD" : ""}.
              </p>
            </>
          ) : r.doi_status === "pending" ? (
            <p className="text-sm text-muted">Registering <span className="font-mono">{r.doi}</span> with DataCite… refresh in a moment.</p>
          ) : r.doi_status === "failed" ? (
            <>
              <p className="text-sm text-red-700 dark:text-red-400">Registration failed: {r.doi_error}</p>
              {isReviewer && <RequestDoiForm reviewId={r.id} retry />}
            </>
          ) : !doiOn ? (
            <p className="text-sm text-muted">
              DOI registration isn&apos;t enabled on this Fjournal instance yet. The review is already permanent, hashed and
              citable at its stable address.
            </p>
          ) : isReviewer ? (
            <>
              <p className="text-sm text-muted">
                Give your review a permanent DOI so it counts as scholarly output on your CV, in ORCID and in citation databases.
                {!r.reviewer_orcid && (
                  <>
                    {" "}<Link href="/settings" className="text-accent underline">Connect your ORCID</Link> first to have it
                    linked to your iD.
                  </>
                )}
              </p>
              <RequestDoiForm reviewId={r.id} />
            </>
          ) : (
            <p className="text-sm text-muted">The reviewer hasn&apos;t registered a DOI for this review.</p>
          )}
        </div>
      </section>

      <section className="card space-y-1 p-5 text-xs text-muted">
        <h2 className="mb-2 text-sm font-semibold text-ink">Permanent record</h2>
        <p>
          This review is part of Fjournal&apos;s public review chain and cannot be edited.{" "}
          {r.ledger_seq ? (
            <>Review ledger entry #{r.ledger_seq} · content <span className="hash">sha256:{r.ledger_hash}</span></>
          ) : (
            "Ledger entry pending."
          )}
        </p>
        <p>
          It commits to the exact text it reviewed: fj:{c.id} v{r.version_number}, <span className="hash">sha256:{v.content_hash}</span>.{" "}
          <Link href="/ledger" className="underline">Verify the ledger</Link>
        </p>
      </section>
    </div>
  );
}
